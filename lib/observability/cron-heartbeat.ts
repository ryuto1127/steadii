import "server-only";
import { db } from "@/lib/db/client";
import { cronHeartbeats } from "@/lib/db/schema";
import { CRON_MANIFEST } from "@/lib/cron/manifest";

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
// GENERATED from lib/cron/manifest.ts — the single source of truth for
// which crons own a LIVE QStash schedule and at what cadence. /api/health
// therefore monitors exactly the manifest set. Do NOT hand-maintain a
// second map here: add/retire a schedule by editing the manifest, and
// this map + DEPLOY.md §11 follow.
//
// Crons consolidated into master-sweep by PR #305 (pre-brief,
// ingest-sweep, draft-superseded, digest, weekly-digest, the 30-min
// expiry sweeps) and the removed send-queue are deliberately absent from
// the manifest — they no longer tick independently, so master-sweep's
// heartbeat is their liveness signal and a sub-sweep failure surfaces via
// the Sentry capture tagged `feature=master_sweep, sub_sweep=<name>`.
// Listing them would re-introduce the permanent-degraded false positive
// PR #341 fixed.
export const CRON_EXPECTED_INTERVAL_MS: Record<string, number> =
  Object.fromEntries(
    CRON_MANIFEST.map((c) => [c.name, c.expectedIntervalMs])
  );

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

