// 2026-05-21 — QStash-triggered cron that resolves pending
// draft_reply queue items when the user replied directly via Gmail
// (instead of using Steadii's Send button).
//
// Recommended QStash cadence: every 10 minutes. The 10-min latency
// matches the user-perception threshold for "Steadii noticed I
// already replied" — fast enough to feel responsive, slow enough
// not to thrash Gmail API quotas.

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";
import {
  defaultSentSinceProbe,
  runDraftSupersededSweep,
} from "@/lib/agent/email/draft-superseded-sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return withHeartbeat("draft-superseded", () =>
    Sentry.startSpan(
      { name: "cron.draft_superseded", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        const probe = await defaultSentSinceProbe();
        const result = await runDraftSupersededSweep({ probe });

        return NextResponse.json({ ok: true, ...result });
      },
    ),
  );
}
