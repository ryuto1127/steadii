// 2026-05-21 — Phase 4 of α-auto-cal. QStash-triggered cron that
// promotes provisional auto-created calendar events to 'confirmed'
// once their 24h grace window expires, dropping the `[Steadii] `
// prefix from the calendar event title.
//
// Recommended QStash cadence: every 30 minutes. The detector +
// evaluator are the upstream bottleneck (a mutual agreement can
// happen at any time), and the 24h grace gives us plenty of slack
// — a 30-min cadence keeps promotion-to-title-rename latency under
// 30 minutes, which is well below human-perception threshold for
// "did Steadii forget to clean up the prefix?".

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";
import {
  defaultCalendarTitleEditor,
  runAutoCalGraceSweep,
} from "@/lib/agent/proactive/auto-cal-grace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return withHeartbeat("auto-cal-grace", () =>
    Sentry.startSpan(
      { name: "cron.auto_cal_grace", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        const editor = await defaultCalendarTitleEditor();
        const result = await runAutoCalGraceSweep({
          nowMs: Date.now(),
          editor,
        });

        return NextResponse.json({
          ok: true,
          ...result,
        });
      },
    ),
  );
}
