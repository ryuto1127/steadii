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

// Expected interval per cron name in milliseconds. Adjusted from the
// QStash schedule documented in DEPLOY.md. A cron is "stale" when
// last_tick_at is older than `expected_ms × stale_multiplier`.
//
// Add new crons here when introducing them — the health endpoint
// consults this map to compute staleness.
export const CRON_EXPECTED_INTERVAL_MS: Record<string, number> = {
  "digest": 60 * 60 * 1000, // hourly tick
  "weekly-digest": 60 * 60 * 1000, // hourly tick; internal Sun 5pm gate
  "pre-brief": 5 * 60 * 1000, // every 5 minutes
  "ingest-sweep": 30 * 60 * 1000, // every 30 minutes (approx)
  "send-queue": 60 * 1000, // every minute
  "scanner": 5 * 60 * 1000, // every 5 minutes
  "groups": 6 * 60 * 60 * 1000, // every 6 hours
  "ical-sync": 30 * 60 * 1000, // every 30 minutes
  // engineer-38 — writing-style learner. Daily 08:00 UTC.
  "style-learner": 24 * 60 * 60 * 1000,
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

