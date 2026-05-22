import "server-only";

import * as Sentry from "@sentry/nextjs";

// 2026-05-22 — Modulo-dispatched master cron orchestrator. The HTTP
// handler at app/api/cron/master-sweep/route.ts is a thin wrapper that
// wires up the production sub-sweeps and delegates here. The pure
// logic lives in this module so it's unit-testable without the HTTP
// or DB layers.
//
// Why this exists: Neon's serverless Postgres bills idle time in
// 5-minute windows. Every cron tick that lands inside a 5-min idle
// window prevents the DB from sleeping. With 4 overlapping
// high-frequency schedules the DB was never sleeping, eating the
// entire Free-tier 100 CU-hour/month allowance. Consolidating those
// wakes into a single 15-min cadence cuts CU-hour burn ~3x.
//
// Schedule (the master cron fires every 15 min via QStash):
//   - ALWAYS  (every 15 min)     → pre-brief, ingest-sweep
//   - WHEN minute % 30 === 0     → auto-cal-grace, draft-superseded
//   - WHEN minute === 0 (hourly) → digest, weekly-digest

export type SubSweepName =
  | "pre-brief"
  | "ingest-sweep"
  | "auto-cal-grace"
  | "draft-superseded"
  | "digest"
  | "weekly-digest";

export type SubSweepFn = () => Promise<unknown>;

export type SubSweeps = Record<SubSweepName, SubSweepFn>;

export type MasterSweepSummary = {
  tickAt: string;
  minute: number;
  ran: SubSweepName[];
  skipped: SubSweepName[];
  errors: Record<string, string>;
  results: Record<string, unknown>;
};

// Pure dispatch. The caller passes in the sub-sweep functions so
// tests can substitute mocks without spinning up Gmail / DB clients.
// Per-sub-sweep failures are isolated: one throwing does NOT block
// the others — each error lands in `summary.errors[name]` and emits
// a Sentry capture tagged with the sub-sweep name so existing
// per-feature alerting still works.
export async function dispatchMasterSweep(args: {
  nowMs: number;
  subSweeps: SubSweeps;
}): Promise<MasterSweepSummary> {
  const { nowMs, subSweeps } = args;
  const minute = new Date(nowMs).getUTCMinutes();

  const summary: MasterSweepSummary = {
    tickAt: new Date(nowMs).toISOString(),
    minute,
    ran: [],
    skipped: [],
    errors: {},
    results: {},
  };

  await tryRun(summary, "pre-brief", subSweeps);
  await tryRun(summary, "ingest-sweep", subSweeps);

  if (minute % 30 === 0) {
    await tryRun(summary, "auto-cal-grace", subSweeps);
    await tryRun(summary, "draft-superseded", subSweeps);
  } else {
    summary.skipped.push("auto-cal-grace", "draft-superseded");
  }

  if (minute === 0) {
    await tryRun(summary, "digest", subSweeps);
    await tryRun(summary, "weekly-digest", subSweeps);
  } else {
    summary.skipped.push("digest", "weekly-digest");
  }

  return summary;
}

async function tryRun(
  summary: MasterSweepSummary,
  name: SubSweepName,
  subSweeps: SubSweeps
): Promise<void> {
  try {
    const result = await subSweeps[name]();
    summary.ran.push(name);
    summary.results[name] = result ?? null;
  } catch (err) {
    summary.errors[name] = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { feature: "master_sweep", sub_sweep: name },
    });
  }
}
