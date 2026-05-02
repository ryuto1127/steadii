import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { runPreBriefScan } from "@/lib/agent/pre-brief/scanner";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Triggered by QStash on a 5-minute cron. For each user with
// pre_brief_enabled=true, finds events starting in ~15 min that have
// attendees and generates / refreshes the brief into event_pre_briefs.
//
// Recommended QStash schedule: */5 * * * * (every 5 min). The 13-18min
// look-ahead window in the scanner is offset so consecutive ticks don't
// double-brief the same event; the (user_id, event_id) unique index
// in event_pre_briefs is the safety net if they ever do.
export async function POST(req: Request) {
  return Sentry.startSpan(
    { name: "cron.pre_brief.tick", op: "cron" },
    async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      try {
        const report = await runPreBriefScan();
        return NextResponse.json(report);
      } catch (err) {
        Sentry.captureException(err, { tags: { feature: "pre_brief_cron" } });
        return NextResponse.json(
          { error: "scan_failed" },
          { status: 500 }
        );
      }
    }
  );
}
