import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentSenderFeedback, users } from "@/lib/db/schema";
import {
  countSignalRowsForUser,
  extractWritingStyleRules,
} from "@/lib/agent/email/style-learner";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-38 — daily writing-style learner. QStash schedule (configured
// on the Upstash console — see DEPLOY.md) recommended cadence is daily
// at 08:00 UTC. Per memory feedback_qstash_orphan_schedules.md, the
// schedule must be created on the Upstash console after deploy AND the
// route registered here.
//
// The cron iterates users who have ≥5 (original, edited) feedback pairs
// recorded since the last run, calls extractWritingStyleRules per user,
// and writes the resulting rule sentences into agent_rules. Per-user
// failures are captured and skipped — one bad user can't block the
// rest.
const MIN_SIGNAL_ROWS = 5;

export async function POST(req: Request) {
  return withHeartbeat("style-learner", () =>
    Sentry.startSpan(
      { name: "cron.style_learner.daily", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 }
          );
        }

        // Pick distinct user ids that have at least one (original, edited)
        // pair. The countSignalRowsForUser gate below filters down to
        // users who clear the MIN_SIGNAL_ROWS threshold. We don't track a
        // last-run cursor — extractWritingStyleRules replaces the rule
        // slate per call, so re-running daily on the same data is a no-op
        // (a model call is wasted, but the rules don't drift).
        const candidates = await db
          .selectDistinct({ userId: agentSenderFeedback.userId })
          .from(agentSenderFeedback)
          .innerJoin(users, eq(users.id, agentSenderFeedback.userId))
          .where(
            and(
              isNull(users.deletedAt),
              isNotNull(agentSenderFeedback.editedBody),
              isNotNull(agentSenderFeedback.originalDraftBody)
            )
          );

        let processed = 0;
        let skipped = 0;
        let failed = 0;
        let totalRulesWritten = 0;

        for (const c of candidates) {
          try {
            const signal = await countSignalRowsForUser(c.userId);
            if (signal < MIN_SIGNAL_ROWS) {
              skipped++;
              continue;
            }
            const out = await extractWritingStyleRules(c.userId);
            processed++;
            totalRulesWritten += out.rulesWritten;
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "style_learner_cron" },
              user: { id: c.userId },
            });
          }
        }

        // Surfaces the daily volume in the cron audit log without spamming
        // a per-user row when the work was a no-op. Same level of detail
        // the digest cron reports back.
        return NextResponse.json({
          tickAt: new Date().toISOString(),
          considered: candidates.length,
          processed,
          skipped,
          failed,
          rulesWritten: totalRulesWritten,
        });
      }
    )
  );
}

// Avoid drizzle-kit picking the import as unused when only used in `sql`
// templated queries — the explicit reference here is harmless and keeps
// the lint clean if a future query uses sql.raw directly.
void sql;
