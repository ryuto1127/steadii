import "server-only";
import { db } from "@/lib/db/client";
import { cronHeartbeats } from "@/lib/db/schema";

// Wave 5 — cron heartbeat infrastructure for pre-public observability.
// Each scheduled handler upserts a single row keyed by cron name on
// every tick. A health endpoint compares last_tick_at against per-cron
// expected cadence to surface missed ticks before they cascade.
//
// We chose a flat (name, last_tick_at) row over per-tick history so
// the table stays bounded — Sentry holds the per-tick exception trail
// for failures; this is just liveness.

// Expected interval per cron name in milliseconds. A cron is "stale"
// when last_tick_at is older than `expected_ms × stale_multiplier`.
//
// Only crons that own a LIVE QStash schedule belong here — each is
// stamped by `withHeartbeat("<name>", …)` wrapping its route POST, so a
// missing/old row means that schedule actually stopped firing.
//
// Deliberately NOT listed (would otherwise be permanent false
// positives, masking a real outage via alert fatigue):
//   • digest, weekly-digest, pre-brief, ingest-sweep — consolidated
//     into `master-sweep` by PR #305 (2026-05-22). Their standalone
//     routes are no longer scheduled in QStash (kept only as manual /
//     rollback triggers), so their heartbeats would freeze even though
//     the work still runs every tick. `master-sweep`'s heartbeat is the
//     liveness signal for all consolidated sub-sweeps; a per-sub-sweep
//     failure still surfaces via the Sentry capture tagged
//     `feature=master_sweep, sub_sweep=<name>` in
//     app/api/cron/master-sweep/route.ts.
//   • send-queue — removed 2026-05-04 (post-α #6); approved sends now
//     publish a per-draft QStash message instead. See DEPLOY.md §11.
//
// Add new crons here when introducing a new independent schedule. If the
// master-sweep consolidation is ever rolled back (standalone schedules
// re-enabled in QStash), re-add the four consolidated names above.
export const CRON_EXPECTED_INTERVAL_MS: Record<string, number> = {
  "scanner": 5 * 60 * 1000, // every 5 minutes
  "groups": 6 * 60 * 60 * 1000, // every 6 hours
  "ical-sync": 30 * 60 * 1000, // every 30 minutes
  // Consolidated master cron — fans out to pre-brief / ingest-sweep
  // (every tick), the 30-min expiry/resurface sweeps, and digest /
  // weekly-digest (hourly) via modulo dispatch. Single 15-min cadence
  // cuts Neon CU-hour burn ~3x. See app/api/cron/master-sweep/route.ts
  // and lib/cron/master-sweep.ts.
  "master-sweep": 15 * 60 * 1000,
  // engineer-38 — writing-style learner. Daily 08:00 UTC.
  "style-learner": 24 * 60 * 60 * 1000,
  // engineer-43 — Gmail Push watch refresh. Daily 04:00 UTC; Gmail
  // watches lapse after 7 days so a missed run silently degrades the
  // Type C read-filter to "everything shows".
  "gmail-watch-refresh": 24 * 60 * 60 * 1000,
  // engineer-51 — entity-graph backfill. Daily 03:00 UTC; chews
  // through unlinked legacy rows (50 per tick) so the entity graph
  // catches up on data from before the resolver shipped.
  "entity-backfill": 24 * 60 * 60 * 1000,
};

const STALE_MULTIPLIER = 2;

export type HeartbeatStatus = "ok" | "error";

/**
 * Stamp a heartbeat for the given cron name. Call from each scheduled
 * handler at end-of-tick so the recorded duration reflects total work.
 * Failures here are swallowed — heartbeat infra must never block the
 * cron's actual job from completing.
 */
export async function recordHeartbeat(
  name: string,
  args: {
    durationMs: number;
    status: HeartbeatStatus;
    error?: string | null;
  }
): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(cronHeartbeats)
      .values({
        name,
        lastTickAt: now,
        lastStatus: args.status,
        lastDurationMs: args.durationMs,
        lastError: args.error ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: cronHeartbeats.name,
        set: {
          lastTickAt: now,
          lastStatus: args.status,
          lastDurationMs: args.durationMs,
          lastError: args.error ?? null,
          updatedAt: now,
        },
      });
  } catch (err) {
    // Heartbeat persistence is non-fatal — log to console for the
    // local dev case. Production observability lives in Sentry where
    // the surrounding span captures the actual cron success/failure.
    console.warn(`[cron-heartbeat] persist failed for ${name}`, err);
  }
}

/**
 * Wrap a cron handler so the heartbeat fires automatically. The wrapper
 * times the handler, captures any thrown error, and stamps the row
 * exactly once per tick (success or failure). Errors are re-thrown so
 * the caller's existing Sentry capture path stays intact.
 */
export async function withHeartbeat<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await recordHeartbeat(name, {
      durationMs: Date.now() - startedAt,
      status: "ok",
    });
    return result;
  } catch (err) {
    await recordHeartbeat(name, {
      durationMs: Date.now() - startedAt,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export type HealthRow = {
  name: string;
  expectedIntervalMs: number;
  lastTickAt: Date | null;
  lastStatus: HeartbeatStatus | null;
  lastDurationMs: number | null;
  ageMs: number | null;
  stale: boolean;
};

/**
 * Read every known cron's heartbeat and report whether each is stale
 * (older than the expected interval × multiplier). Used by the
 * `/api/health` endpoint and the admin dashboard's cron health
 * section. We always return a row per known cron — even if no
 * heartbeat has been recorded yet — so the dashboard surfaces
 * "never run" as `lastTickAt: null, stale: true` cleanly.
 */
export async function readCronHealth(): Promise<HealthRow[]> {
  const rows = await db
    .select({
      name: cronHeartbeats.name,
      lastTickAt: cronHeartbeats.lastTickAt,
      lastStatus: cronHeartbeats.lastStatus,
      lastDurationMs: cronHeartbeats.lastDurationMs,
    })
    .from(cronHeartbeats);
  const map = new Map(rows.map((r) => [r.name, r]));
  const now = Date.now();
  const out: HealthRow[] = [];
  for (const [name, expectedIntervalMs] of Object.entries(
    CRON_EXPECTED_INTERVAL_MS
  )) {
    const r = map.get(name);
    const lastTickAt = r?.lastTickAt ?? null;
    const ageMs = lastTickAt ? now - lastTickAt.getTime() : null;
    const stale =
      ageMs === null || ageMs > expectedIntervalMs * STALE_MULTIPLIER;
    out.push({
      name,
      expectedIntervalMs,
      lastTickAt,
      lastStatus: (r?.lastStatus as HeartbeatStatus | undefined) ?? null,
      lastDurationMs: r?.lastDurationMs ?? null,
      ageMs,
      stale,
    });
  }
  return out;
}

