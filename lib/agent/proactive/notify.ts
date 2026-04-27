import "server-only";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  type ActionOption,
  type ProposalSourceRef,
} from "@/lib/db/schema";
import { buildDedupKey } from "./dedup";

// D11 — communication-first. Every silent automated action that
// affects user state lands as a low-priority "Steadii did X"
// inbox row so the user never has to wonder what changed. This
// helper is the single insertion point: auto-import flows, learning
// updates, etc. all funnel through `recordAutoActionLog`.
//
// Implementation detail: the row reuses `agent_proposals` with
// `issueType='auto_action_log'` and `status='resolved'` on creation
// so the dismiss/resolve endpoints don't double-handle it. The
// inbox list renders these as a muted "Action" pill (vs the bold
// "Proposal" pill for pending issues).

export async function recordAutoActionLog(args: {
  userId: string;
  summary: string;
  reasoning: string;
  sourceRefs?: ProposalSourceRef[];
  // Stable identifier for dedup. Two auto-action logs with the same
  // (issueType + sourceRecordIds) collapse into one row, matching the
  // proposal dedup story.
  dedupRecordIds: string[];
}): Promise<{ id: string } | null> {
  const dedupKey = buildDedupKey("auto_action_log", args.dedupRecordIds);
  const okOption: ActionOption = {
    key: "ok",
    label: "OK",
    description: "Acknowledge and clear.",
    tool: "auto",
    payload: {},
  };
  const inserted = await db
    .insert(agentProposals)
    .values({
      userId: args.userId,
      issueType: "auto_action_log",
      issueSummary: args.summary,
      reasoning: args.reasoning,
      sourceRefs: args.sourceRefs ?? [],
      actionOptions: [okOption],
      dedupKey,
      status: "resolved",
      resolvedAction: "auto",
      resolvedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    })
    .returning({ id: agentProposals.id });
  return inserted.length > 0 ? inserted[0] : null;
}
