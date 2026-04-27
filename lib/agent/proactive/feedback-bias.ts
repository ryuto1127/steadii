import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import {
  agentSenderFeedback,
  type AgentProposalIssueType,
} from "@/lib/db/schema";

// Reuses the polish-7 agent_sender_feedback table for proactive
// proposals per D6. The "sender" column carries
// "proactive:<issue_type>" as a pseudo-sender; senderDomain is fixed
// "proactive". proposedAction is always "notify_only" so the existing
// AgentDraftAction enum stays unchanged. userResponse uses the same
// values as email feedback (dismissed / sent / edited / auto_sent).

const FEEDBACK_LOOKBACK_DAYS = 30;
const FEEDBACK_READ_LIMIT = 10;
const PROACTIVE_DOMAIN = "proactive";

export const PROACTIVE_PROPOSED_ACTION = "notify_only" as const;

export function pseudoSenderForIssue(
  issueType: AgentProposalIssueType
): string {
  return `proactive:${issueType}`;
}

export type ProactiveFeedbackBias = {
  issueType: AgentProposalIssueType;
  windowDays: number;
  totalRows: number;
  // Counts of the user's prior responses to this issue type. The
  // proposal LLM tilts options toward `sent` / `edited` patterns and
  // away from issues frequently `dismissed`.
  responseCounts: Record<string, number>;
  // A 1-line summary the LLM can fold into its system prompt.
  hint: string | null;
};

// Read the user's prior responses for proactive proposals of this
// issue type. Failures fall through to null so the proposal generator
// degrades gracefully.
export async function loadProactiveFeedbackBias(args: {
  userId: string;
  issueType: AgentProposalIssueType;
}): Promise<ProactiveFeedbackBias | null> {
  try {
    const since = sql`now() - interval '${sql.raw(
      `${FEEDBACK_LOOKBACK_DAYS} days`
    )}'`;
    const rows = await db
      .select({
        userResponse: agentSenderFeedback.userResponse,
      })
      .from(agentSenderFeedback)
      .where(
        and(
          eq(agentSenderFeedback.userId, args.userId),
          eq(
            agentSenderFeedback.senderEmail,
            pseudoSenderForIssue(args.issueType)
          ),
          gte(agentSenderFeedback.createdAt, since)
        )
      )
      .orderBy(desc(agentSenderFeedback.createdAt))
      .limit(FEEDBACK_READ_LIMIT);

    if (rows.length === 0) return null;

    const responseCounts: Record<string, number> = {};
    for (const r of rows) {
      responseCounts[r.userResponse] =
        (responseCounts[r.userResponse] ?? 0) + 1;
    }
    return {
      issueType: args.issueType,
      windowDays: FEEDBACK_LOOKBACK_DAYS,
      totalRows: rows.length,
      responseCounts,
      hint: buildHint(args.issueType, responseCounts),
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        feature: "proactive_feedback_bias",
        op: "read",
        issueType: args.issueType,
      },
      user: { id: args.userId },
    });
    return null;
  }
}

// Record a proactive proposal's resolution for the bias loop.
export async function recordProactiveFeedback(args: {
  userId: string;
  issueType: AgentProposalIssueType;
  userResponse: "dismissed" | "sent" | "edited" | "auto_sent";
  proposalId: string | null;
}): Promise<void> {
  try {
    await db.insert(agentSenderFeedback).values({
      userId: args.userId,
      senderEmail: pseudoSenderForIssue(args.issueType),
      senderDomain: PROACTIVE_DOMAIN,
      proposedAction: PROACTIVE_PROPOSED_ACTION,
      userResponse: args.userResponse,
      // proactive proposals don't have an inbox_item / agent_draft FK;
      // leave them null. The proposalId is logged on the dedup row
      // itself (status / resolvedAction columns).
      inboxItemId: null,
      agentDraftId: null,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "proactive_feedback_bias", op: "write" },
      user: { id: args.userId },
    });
  }
}

function buildHint(
  issueType: AgentProposalIssueType,
  counts: Record<string, number>
): string {
  const dismissed = counts.dismissed ?? 0;
  const acted = (counts.sent ?? 0) + (counts.edited ?? 0);
  const total = dismissed + acted;
  if (total === 0) return "";
  if (dismissed >= 3 && dismissed > acted) {
    return `User dismissed ${dismissed} of ${total} prior ${issueType} proposals — keep options conservative; `
      + `lead with the cheapest action (chat_followup or dismiss).`;
  }
  if (acted >= 2 && acted > dismissed) {
    return `User acted on ${acted} of ${total} prior ${issueType} proposals — full action menu is welcome; `
      + `surface the strongest concrete option (email_professor or reschedule_event).`;
  }
  return "";
}
