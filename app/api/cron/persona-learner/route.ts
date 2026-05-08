import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems, users } from "@/lib/db/schema";
import { runPersonaExtractionForUser } from "@/lib/agent/email/persona-learner";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-39 — daily contact persona learner. QStash schedule
// (configured on the Upstash console — see DEPLOY.md) recommended
// cadence is daily at 09:00 UTC. Per memory feedback_qstash_orphan_schedules.md,
// the schedule must be created on the Upstash console after deploy AND
// the route registered here.
//
// The cron iterates active users (any user with inbox activity in the
// last 7 days) and calls runPersonaExtractionForUser for each. The
// per-user runner self-gates on (no persona row OR last_extracted_at <
// now() - 7d), so re-running daily on the same data is a near-no-op
// (one cheap distinct-sender query per user). Per-user failures are
// captured + skipped — one bad user can't block the rest.
//
// Cost ceiling — see lib/agent/email/persona-learner.ts header. The
// 7-day stale gate cuts the call rate to ~10% of theoretical at α scale.
const ACTIVE_USER_WINDOW_DAYS = 7;

export async function POST(req: Request) {
  return withHeartbeat("persona-learner", () =>
    Sentry.startSpan(
      { name: "cron.persona_learner.daily", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 }
          );
        }

        const cutoff = new Date(
          Date.now() - ACTIVE_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000
        );

        // Active = any user with at least one inbox row received in the
        // last 7 days. Soft-deleted users are excluded so wiped accounts
        // don't burn cron quota. The runner inside selectActiveContactsForUser
        // does its own ACTIVE_WINDOW_DAYS=30 sender filter; this outer
        // gate is just "is this user worth checking at all today."
        const candidates = await db
          .selectDistinct({ userId: inboxItems.userId })
          .from(inboxItems)
          .innerJoin(users, eq(users.id, inboxItems.userId))
          .where(
            and(
              isNull(users.deletedAt),
              gte(inboxItems.receivedAt, cutoff)
            )
          );

        let processed = 0;
        let failed = 0;
        let totalConsidered = 0;
        let totalExtracted = 0;
        let totalSkipped = 0;

        for (const c of candidates) {
          try {
            const out = await runPersonaExtractionForUser(c.userId);
            processed++;
            totalConsidered += out.considered;
            totalExtracted += out.extracted;
            totalSkipped += out.skipped;
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "persona_learner_cron" },
              user: { id: c.userId },
            });
          }
        }

        return NextResponse.json({
          tickAt: new Date().toISOString(),
          considered: candidates.length,
          processed,
          failed,
          totalContactsConsidered: totalConsidered,
          totalContactsExtracted: totalExtracted,
          totalContactsSkipped: totalSkipped,
        });
      }
    )
  );
}

// Avoid drizzle-kit picking unused imports.
void sql;
