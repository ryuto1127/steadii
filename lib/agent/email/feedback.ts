import "server-only";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import {
  agentSenderFeedback,
  type AgentDraftAction,
  type AgentSenderFeedbackResponse,
} from "@/lib/db/schema";
import type { RecentFeedbackSummary } from "./classify-deep";

// polish-7 — central helper for the per-user feedback loop. Hooks into
// the four user-action moments (dismiss / send / edit / auto_sent) and
// the L2 deep-pass classifier reads it back. Failures are swallowed:
// the feedback log is a learning signal, not load-bearing data — never
// block a Send/Dismiss because we couldn't write a feedback row.

// Reading window. Capped at 30 days because student term contexts shift
// every ~3 months — older signal is stale.
const FEEDBACK_LOOKBACK_DAYS = 30;
// Read N rows back. Plenty for the prompt block; the count aggregation
// stays at this slate.
const FEEDBACK_READ_LIMIT = 5;

// Sender-level rows take precedence; if none exist, fall back to a
// domain-level slate. Exact-match wins when both are populated, since
// per-sender behavior is more reliable than a domain-wide aggregate.
export async function loadRecentFeedbackSummary(args: {
  userId: string;
  senderEmail: string;
  senderDomain: string;
}): Promise<RecentFeedbackSummary | null> {
  try {
    const since = sql`now() - interval '${sql.raw(
      `${FEEDBACK_LOOKBACK_DAYS} days`
    )}'`;
    const rows = await db
      .select({
        proposedAction: agentSenderFeedback.proposedAction,
        userResponse: agentSenderFeedback.userResponse,
        senderEmail: agentSenderFeedback.senderEmail,
      })
      .from(agentSenderFeedback)
      .where(
        and(
          eq(agentSenderFeedback.userId, args.userId),
          or(
            eq(agentSenderFeedback.senderEmail, args.senderEmail),
            eq(agentSenderFeedback.senderDomain, args.senderDomain)
          ),
          gte(agentSenderFeedback.createdAt, since)
        )
      )
      .orderBy(desc(agentSenderFeedback.createdAt))
      .limit(FEEDBACK_READ_LIMIT);

    if (rows.length === 0) return null;

    const senderRows = rows.filter(
      (r) => r.senderEmail === args.senderEmail
    );
    const useSender = senderRows.length > 0;
    const slice = useSender ? senderRows : rows;

    const proposedCounts: Record<string, Record<string, number>> = {};
    for (const r of slice) {
      const p = r.proposedAction;
      const u = r.userResponse;
      proposedCounts[p] ??= {};
      proposedCounts[p][u] = (proposedCounts[p][u] ?? 0) + 1;
    }

    return {
      scope: useSender ? "sender" : "domain",
      proposedCounts,
      windowDays: FEEDBACK_LOOKBACK_DAYS,
      totalRows: slice.length,
    };
  } catch (err) {
    // The feedback prompt block is a nice-to-have; a read failure should
    // not break L2 classification.
    Sentry.captureException(err, {
      tags: { feature: "agent_sender_feedback", op: "read" },
      user: { id: args.userId },
    });
    return null;
  }
}

// Insert one feedback row. Caller passes the agent_draft id and inbox
// item id so the row links back; senderEmail/Domain are denormalized so
// the read query can hit a btree index without a join.
export async function recordSenderFeedback(args: {
  userId: string;
  senderEmail: string;
  senderDomain: string;
  proposedAction: AgentDraftAction;
  userResponse: AgentSenderFeedbackResponse;
  inboxItemId: string | null;
  agentDraftId: string | null;
}): Promise<void> {
  try {
    await db.insert(agentSenderFeedback).values({
      userId: args.userId,
      senderEmail: args.senderEmail,
      senderDomain: args.senderDomain,
      proposedAction: args.proposedAction,
      userResponse: args.userResponse,
      inboxItemId: args.inboxItemId,
      agentDraftId: args.agentDraftId,
    });
  } catch (err) {
    // Same swallow rationale: writing the feedback row must never block
    // the user-driven send/dismiss/edit. We log to Sentry so a
    // schema/index regression still surfaces.
    Sentry.captureException(err, {
      tags: { feature: "agent_sender_feedback", op: "write" },
      user: { id: args.userId },
    });
  }
}

// Reset all feedback rows for one (user, sender) pair. Powers the
// "this contact's history was wrong → start fresh" affordance in
// Settings → Agent Rules. Returns the count of removed rows so the
// settings UI can confirm.
export async function clearSenderFeedback(args: {
  userId: string;
  senderEmail: string;
}): Promise<number> {
  const result = await db
    .delete(agentSenderFeedback)
    .where(
      and(
        eq(agentSenderFeedback.userId, args.userId),
        eq(agentSenderFeedback.senderEmail, args.senderEmail)
      )
    )
    .returning({ id: agentSenderFeedback.id });
  return result.length;
}
