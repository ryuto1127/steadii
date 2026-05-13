import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { runEntityBackfill } from "@/lib/agent/entity-graph/backfill";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-51 — entity-graph backfill cron. Daily 03:00 UTC via QStash.
// Picks up source rows (inbox_items / agent_drafts / assignments /
// chat_messages) that don't yet have an entity_links row and runs the
// resolver against them. Bounded per tick so the QStash request budget
// doesn't blow up — 50 rows / tick, 10 / user.
//
// Eventually the backfill drains and the cron is a near-no-op (the
// resolver fires on every new source row going forward). At that
// point the schedule can be relaxed, but α leaves it daily as cheap
// insurance against backfill regressions.
export async function POST(req: Request) {
  return withHeartbeat("entity-backfill", () =>
    Sentry.startSpan(
      {
        name: "cron.entity_backfill.tick",
        op: "cron",
      },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        const tickAt = new Date();
        try {
          const result = await runEntityBackfill();
          return NextResponse.json({
            tickAt: tickAt.toISOString(),
            processed: result.processed,
            bySource: result.bySource,
            userCount: Object.keys(result.perUser).length,
          });
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: "entity_graph", phase: "backfill_cron" },
          });
          return NextResponse.json(
            {
              error: "backfill_failed",
              message: err instanceof Error ? err.message : String(err),
            },
            { status: 500 }
          );
        }
      }
    )
  );
}
