import { NextResponse } from "next/server";
import { readCronHealth } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Wave 5 — pre-public health endpoint. External monitors hit this to
// detect:
//   - cron staleness (any heartbeat older than 2× expected interval)
//   - last-tick errors (any cron whose most recent run failed)
//
// Status semantics:
//   200 + status='ok'      — all crons fresh, last status ok
//   200 + status='degraded' — at least one cron stale or last-tick error
//   500                    — endpoint itself errored (likely DB outage)
//
// Stays unauthenticated by design: it must respond even if the
// integrations layer (auth, Stripe, etc.) is broken. Doesn't leak
// user data — only cron names + timing.
export async function GET() {
  try {
    const rows = await readCronHealth();
    const stale = rows.filter((r) => r.stale).map((r) => r.name);
    const failing = rows
      .filter((r) => r.lastStatus === "error")
      .map((r) => r.name);
    const status = stale.length === 0 && failing.length === 0 ? "ok" : "degraded";
    return NextResponse.json({
      status,
      checkedAt: new Date().toISOString(),
      stale,
      failing,
      crons: rows.map((r) => ({
        name: r.name,
        expectedIntervalMs: r.expectedIntervalMs,
        lastTickAt: r.lastTickAt?.toISOString() ?? null,
        ageMs: r.ageMs,
        lastStatus: r.lastStatus,
        lastDurationMs: r.lastDurationMs,
        stale: r.stale,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
