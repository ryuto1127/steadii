import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentProposals } from "@/lib/db/schema";

// "Steadii noticed" feed — recent passive auto-action records that the
// bell + digest surface. Inbox no longer renders these (per Fix 5,
// 2026-04-29) so the user's triage queue stays user-actionable only.
//
// Implementation reuses `agent_proposals` filtered to
// `issue_type = 'auto_action_log'` rather than introducing a separate
// `agent_auto_actions` table — same persistence story, less migration
// risk pre-α. Explicit dismiss is post-α (today the 7-day createdAt
// window is the auto-clear).

export type AutoActionFeedItem = {
  id: string;
  summary: string;
  reasoning: string;
  createdAt: Date;
  viewedAt: Date | null;
};

export async function loadRecentAutoActions(
  userId: string,
  options: { withinDays?: number; limit?: number } = {}
): Promise<AutoActionFeedItem[]> {
  const withinDays = options.withinDays ?? 7;
  const limit = options.limit ?? 10;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: agentProposals.id,
      summary: agentProposals.issueSummary,
      reasoning: agentProposals.reasoning,
      createdAt: agentProposals.createdAt,
      viewedAt: agentProposals.viewedAt,
    })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        eq(agentProposals.issueType, "auto_action_log"),
        gt(agentProposals.createdAt, cutoff)
      )
    )
    .orderBy(desc(agentProposals.createdAt))
    .limit(limit);

  return rows;
}
