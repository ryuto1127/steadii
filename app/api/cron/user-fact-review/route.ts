import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  userFacts,
  type ActionOption,
  type NewAgentProposalRow,
} from "@/lib/db/schema";
import { buildDedupKey } from "@/lib/agent/proactive/dedup";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-48 — daily review sweep for aging user_facts.
//
// For each fact whose next_review_at <= now() AND not soft-deleted AND
// not expired, insert one agent_proposals row of type 'user_fact_review'.
// The queue surfaces it as a Type F clarifying card asking the user
// "これ、まだ合ってますか?" with [Confirm / Edit / Delete] options.
// Confirm flows back through userFactReconfirmAction (settings actions);
// Edit deep-links to /app/settings/facts where the same upsert path
// runs; Delete soft-deletes via userFactDeleteAction.
//
// dedupKey = sha256("user_fact_review::<factId>") so the same fact never
// surfaces twice in one review window. The card auto-clears when the
// user resolves it; the next nextReviewAt recompute happens via the
// recompute-on-confirm path in userFactReconfirmAction.
//
// QStash schedule: daily at 08:00 UTC. Configured on Upstash console
// per memory feedback_qstash_orphan_schedules.md.

export async function POST(req: Request) {
  return withHeartbeat("user-fact-review", () =>
    Sentry.startSpan(
      { name: "cron.user_fact_review.daily", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 }
          );
        }

        const now = new Date();
        const dueFacts = await db
          .select({
            id: userFacts.id,
            userId: userFacts.userId,
            fact: userFacts.fact,
            category: userFacts.category,
            nextReviewAt: userFacts.nextReviewAt,
          })
          .from(userFacts)
          .where(
            and(
              isNull(userFacts.deletedAt),
              isNotNull(userFacts.nextReviewAt),
              lte(userFacts.nextReviewAt, now),
              // Don't surface facts that are already past their hard
              // expiry — they'll be filtered out of prompts anyway.
              sql`(${userFacts.expiresAt} IS NULL OR ${userFacts.expiresAt} > ${now})`
            )
          );

        let proposed = 0;
        let skipped = 0;
        let failed = 0;
        for (const f of dueFacts) {
          try {
            const inserted = await insertReviewProposal({
              userId: f.userId,
              factId: f.id,
              fact: f.fact,
              category: f.category,
              now,
            });
            if (inserted) {
              proposed++;
            } else {
              skipped++;
            }
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "user_fact_review_cron" },
              user: { id: f.userId },
            });
          }
        }

        return NextResponse.json({
          tickAt: now.toISOString(),
          considered: dueFacts.length,
          proposed,
          skipped,
          failed,
        });
      }
    )
  );
}

async function insertReviewProposal(args: {
  userId: string;
  factId: string;
  fact: string;
  category: string | null;
  now: Date;
}): Promise<boolean> {
  const { userId, factId, fact, category, now } = args;
  const dedupKey = buildDedupKey("user_fact_review", [factId]);
  const summary = `これ、まだ合ってますか? / Still accurate? — ${truncate(fact, 140)}`;
  const reasoning = [
    `Steadii has been remembering this user fact${
      category ? ` (category: ${category})` : ""
    }:`,
    ``,
    `  "${fact}"`,
    ``,
    `It's been a while since you last confirmed it. Confirm if still right, edit if it's drifted, or delete to forget.`,
  ].join("\n");
  const actionOptions: ActionOption[] = [
    {
      key: "confirm",
      label: "✓ Still right",
      description:
        "Steadii keeps the fact and resets the review clock for this category.",
      tool: "auto",
      payload: { factId, op: "confirm" },
    },
    {
      key: "edit",
      label: "✎ Edit",
      description: "Open the settings page to edit the fact.",
      tool: "chat_followup",
      payload: {
        factId,
        op: "edit",
        seedMessage: `Edit user fact: "${fact}". Open /app/settings/facts to refine it.`,
      },
    },
    {
      key: "delete",
      label: "× Forget",
      description: "Soft-delete the fact. Steadii stops injecting it.",
      tool: "auto",
      payload: { factId, op: "delete" },
    },
  ];
  const row: NewAgentProposalRow = {
    userId,
    issueType: "user_fact_review",
    issueSummary: summary,
    reasoning,
    sourceRefs: [],
    actionOptions,
    dedupKey,
    // Auto-expire after 14 days so an unreviewed card doesn't linger
    // forever. Next cron tick will re-surface if still due.
    expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  };
  const inserted = await db
    .insert(agentProposals)
    .values(row)
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    })
    .returning({ id: agentProposals.id });
  return inserted.length > 0;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
