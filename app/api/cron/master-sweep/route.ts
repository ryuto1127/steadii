import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { dispatchMasterSweep, type SubSweeps } from "@/lib/cron/master-sweep";
import { runPreBriefScan } from "@/lib/agent/pre-brief/scanner";
import { runIngestSweep } from "@/lib/agent/email/ingest-sweep";
import { runAutoCalProposalExpirySweep } from "@/lib/agent/proactive/auto-cal-proposal-expiry";
import { expireStaleProposedArchives } from "@/lib/agent/email/auto-archive";
import {
  defaultSentSinceProbe,
  runDraftSupersededSweep,
  runNotificationExpirySweep,
} from "@/lib/agent/email/draft-superseded-sweep";
import { runDispositionResurfaceSweep } from "@/lib/agent/email/disposition-resurface";
import { runDigestSweep, runWeeklyDigestSweep } from "@/lib/digest/sweep";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Mirror /api/chat: the consolidated sweep fans out across all users
// (ingest + pre-brief + digest dispatch + the 30-min sweeps), which can
// exceed the default serverless function timeout under load. 300s is the
// Vercel max for the Pro plan's Node functions.
export const maxDuration = 300;

// 2026-05-22 — Master cron sweep. Consolidates the high-frequency
// QStash crons into a single schedule (`*/15 * * * *`) to cut Neon CU-
// hour burn ~3x.
//
// WHY: Neon's serverless Postgres bills idle time in 5-minute windows.
// Any cron firing inside 5 min of the previous one prevents the DB
// from sleeping — even a 100ms query incurs the full window. With 4
// overlapping high-frequency schedules (pre-brief @5m, ingest-sweep
// @15m, draft-superseded @10m, auto-cal-grace @30m) the DB was never
// sleeping, draining the Free-plan 100 CU-hour/month allowance.
// Consolidating those wakes into a single 15-min schedule restores
// healthy idle time.
//
// MODULO DISPATCH (the pure logic lives in lib/cron/master-sweep.ts):
//   - ALWAYS  (every 15 min)     → runPreBriefScan, runIngestSweep,
//                                  runDigestSweep, runWeeklyDigestSweep
//   - WHEN minute % 30 === 0     → runAutoCalProposalExpirySweep,
//                                  expireStaleProposedArchives (Round 4),
//                                  runDraftSupersededSweep,
//                                  runDispositionResurfaceSweep
//
// 2026-06-09 — digest dispatch moved out of the minute===0 gate onto the
// every-tick path. The pickers own eligibility (local-hour match + send-
// gap floor), so an off-the-hour tick still serves that hour's cohort and
// a same-day double-send is impossible. Fixes a missed-cohort drop when a
// QStash tick didn't land exactly on :00.
//
// 2026-05-24 — Round-3 propose-confirm. The legacy
// runAutoCalGraceSweep that promoted provisional → confirmed and
// renamed the calendar event title is deregistered. Events only
// land on the user's calendar via the explicit Add action now, so
// there's no prefix to drop and no row to promote. The new
// runAutoCalProposalExpirySweep flips untouched 'proposed' rows to
// 'cancelled' after 7 days — no calendar API call needed.
//
// The pre-brief look-ahead window was widened from 13-18 min to
// 13-30 min to accommodate the new 15-min cadence (see
// lib/agent/pre-brief/scanner.ts).
//
// ─── MANUAL UPSTASH SCHEDULE CHANGES POST-MERGE ──────────────────────
//
// In the Upstash QStash console after this PR is deployed:
//
//   DISABLE (do NOT delete — kept as rollback safety net):
//     - pre-brief schedule
//     - ingest-sweep schedule
//     - draft-superseded schedule
//     - auto-cal-grace schedule
//     - digest schedule
//     - weekly-digest schedule
//
//   ADD:
//     - master-sweep on `*/15 * * * *` → POST /api/cron/master-sweep
//
// The OLD routes (/api/cron/pre-brief, /api/cron/ingest-sweep,
// /api/cron/auto-cal-grace, /api/cron/draft-superseded,
// /api/cron/digest, /api/cron/weekly-digest) remain intact and
// callable. They serve as manual admin triggers for debugging AND as
// a rollback safety net if the schedule swap needs to be undone — in
// that case, re-enable the disabled QStash schedules and disable the
// master-sweep one.
//
// Per-sub-sweep failures are isolated: one throwing does NOT poison
// the others. The response summary surfaces both successes (ran/results)
// and errors.
export async function POST(req: Request) {
  return withHeartbeat("master-sweep", () =>
    Sentry.startSpan(
      { name: "cron.master_sweep.tick", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        const nowMs = Date.now();
        const subSweeps: SubSweeps = {
          "pre-brief": () => runPreBriefScan(),
          "ingest-sweep": () => runIngestSweep(),
          "auto-cal-proposal-expiry": () =>
            runAutoCalProposalExpirySweep({ nowMs }),
          "proposed-archive-expiry": () =>
            expireStaleProposedArchives({ nowMs }),
          "draft-superseded": async () => {
            const probe = await defaultSentSinceProbe();
            return runDraftSupersededSweep({ probe });
          },
          "disposition-resurface": () =>
            runDispositionResurfaceSweep({ now: new Date(nowMs) }),
          // 2026-05-24 — Round-5 notify-with-undo bookkeeping.
          "notification-expiry": () =>
            runNotificationExpirySweep({ now: new Date(nowMs) }),
          digest: () => runDigestSweep(),
          "weekly-digest": () => runWeeklyDigestSweep(),
        };

        const summary = await dispatchMasterSweep({ nowMs, subSweeps });
        return NextResponse.json(summary);
      }
    )
  );
}
