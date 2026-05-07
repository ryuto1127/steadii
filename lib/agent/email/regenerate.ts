import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  users,
  type AgentDraftAction,
  type RetrievalProvenance,
} from "@/lib/db/schema";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { selectModel } from "@/lib/agent/models";
import { buildProvenance, runDeepPass } from "./classify-deep";
import { runDraft, type DraftResult } from "./draft";
import { fetchRecentThreadMessages } from "./thread";
import { logEmailAudit } from "./audit";
import { fanoutForInbox, type FanoutResult } from "./fanout";
import { loadRecentFeedbackSummary } from "./feedback";
import { getUserLocale } from "@/lib/agent/preferences";

// engineer-36 — admin "Regenerate AI drafts" sweep. Re-runs L2 deep + draft
// over open agent_drafts so legacy rows pick up the latest L2 logic
// (PR #168 reasoning locale, PR #170 fanout retrieval quality, etc.) without
// minting a new draft id. user_feedback.agent_draft_id and any queued send
// paths reference the row by id, so an INSERT-then-DELETE swap would orphan
// those signals — UPDATE-in-place keeps them attached.
//
// Scope:
//   - status IN ('pending', 'paused') only — sent/approved/dismissed/expired
//     are out of scope by definition.
//   - riskTier in ('high', 'medium') — low rows have no L2 output to refresh.
//   - Risk pass is NOT re-run. Tier classification is left frozen so queued
//     QStash sends don't see their tier flip mid-life.
//   - Credit-gated: bubbles BillingQuotaExceededError so the loop can stop
//     on first exhaustion rather than burning through every remaining row.

export type RegenerateOutcome =
  | { status: "refreshed"; draftId: string; reasoningLocaleChanged: boolean }
  | { status: "skipped"; draftId: string; reason: string };

export type RegenerateAllOutcome = {
  scanned: number;
  refreshed: number;
  skipped: number;
  creditsExhausted: boolean;
  hasMore: boolean;
};

export async function regenerateDraft(
  draftId: string
): Promise<RegenerateOutcome> {
  const [row] = await db
    .select({
      draftId: agentDrafts.id,
      userId: agentDrafts.userId,
      inboxItemId: agentDrafts.inboxItemId,
      status: agentDrafts.status,
      riskTier: agentDrafts.riskTier,
      action: agentDrafts.action,
      reasoning: agentDrafts.reasoning,
      senderEmail: inboxItems.senderEmail,
      senderDomain: inboxItems.senderDomain,
      senderRole: inboxItems.senderRole,
      senderName: inboxItems.senderName,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      receivedAt: inboxItems.receivedAt,
      threadExternalId: inboxItems.threadExternalId,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(eq(agentDrafts.id, draftId))
    .limit(1);

  if (!row) {
    return { status: "skipped", draftId, reason: "not_found" };
  }
  if (row.status !== "pending" && row.status !== "paused") {
    return { status: "skipped", draftId, reason: `status_${row.status}` };
  }
  if (row.riskTier !== "high" && row.riskTier !== "medium") {
    return {
      status: "skipped",
      draftId,
      reason: row.riskTier ? `tier_${row.riskTier}` : "tier_missing",
    };
  }

  // Credit gate. The loop in regenerateAllOpenDrafts catches this and stops.
  await assertCreditsAvailable(row.userId);

  const [userRow] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  const threadMessages = await fetchRecentThreadMessages({
    userId: row.userId,
    threadExternalId: row.threadExternalId,
    beforeReceivedAt: row.receivedAt,
    limit: 2,
  });

  const locale = await getUserLocale(row.userId);

  let fanout: FanoutResult | null = null;
  let newReasoning = row.reasoning ?? "";
  let newAction: AgentDraftAction = row.action;
  let newRetrievalProvenance: RetrievalProvenance | null = null;
  let draft: DraftResult | null = null;

  if (row.riskTier === "high") {
    try {
      fanout = await fanoutForInbox({
        userId: row.userId,
        inboxItemId: row.inboxItemId,
        phase: "deep",
        subject: row.subject,
        snippet: row.snippet,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_regenerate", step: "fanout_deep" },
        user: { id: row.userId },
        extra: { draftId },
      });
    }

    const recentFeedback = await loadRecentFeedbackSummary({
      userId: row.userId,
      senderEmail: row.senderEmail,
      senderDomain: row.senderDomain,
    });

    const deep = await runDeepPass({
      userId: row.userId,
      senderEmail: row.senderEmail,
      senderDomain: row.senderDomain,
      senderRole: row.senderRole,
      subject: row.subject,
      snippet: row.snippet,
      bodySnippet: row.snippet,
      // Risk pass is intentionally NOT re-run — synthesize a minimal
      // RiskPassResult from the stored tier so the deep prompt still
      // sees a "Tier: high" header. The original reasoning is reused
      // as a placeholder for the risk-pass reasoning slot; it is
      // overwritten on the row by the new deep reasoning we compute
      // immediately below.
      riskPass: {
        riskTier: "high",
        confidence: 1.0,
        reasoning: row.reasoning ?? "(prior risk reasoning unavailable)",
        usageId: null,
      },
      similarEmails: fanout?.similarEmails ?? [],
      totalCandidates: fanout?.totalSimilarCandidates ?? 0,
      threadRecentMessages: threadMessages,
      fanout,
      recentFeedback,
      locale,
    });

    newReasoning = deep.reasoning;
    newAction = deep.action;
    newRetrievalProvenance = deep.retrievalProvenance;
  } else {
    try {
      fanout = await fanoutForInbox({
        userId: row.userId,
        inboxItemId: row.inboxItemId,
        phase: "draft",
        subject: row.subject,
        snippet: row.snippet,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_regenerate", step: "fanout_draft" },
        user: { id: row.userId },
        extra: { draftId },
      });
    }
    // Medium tier: deep pass is skipped entirely, reasoning stays as the
    // original risk-pass reasoning (mirrors L2's medium-tier path). The
    // draft body and provenance still refresh below.
    newAction = "draft_reply";
    newRetrievalProvenance = fanout
      ? buildProvenance({
          similarEmails: fanout.similarEmails,
          totalCandidates: fanout.totalSimilarCandidates,
          fanout,
        })
      : null;
  }

  if (newAction === "draft_reply") {
    draft = await runDraft({
      userId: row.userId,
      senderEmail: row.senderEmail,
      senderName: row.senderName,
      senderRole: row.senderRole,
      subject: row.subject,
      snippet: row.snippet,
      bodySnippet: row.snippet,
      inReplyTo: null,
      threadRecentMessages: threadMessages,
      similarEmails: fanout?.similarEmails ?? [],
      // Legacy calendar-events array — fanout's calendar block already
      // covers events + tasks for both tiers, so this stays empty.
      calendarEvents: [],
      fanout,
      userName: userRow?.name ?? null,
      userEmail: userRow?.email ?? null,
    });

    if (draft.kind === "clarify") {
      newAction = "ask_clarifying";
      newReasoning = draft.reasoning;
    }
  }

  const reasoningLocaleChanged = isLocaleSwitch(row.reasoning, newReasoning);

  await db
    .update(agentDrafts)
    .set({
      reasoning: newReasoning,
      retrievalProvenance: newRetrievalProvenance,
      action: newAction,
      classifyModel:
        row.riskTier === "high"
          ? selectModel("email_classify_deep")
          : selectModel("email_classify_risk"),
      draftModel: draft ? selectModel("email_draft") : null,
      draftSubject: draft?.subject ?? null,
      draftBody: draft?.body ?? null,
      draftTo: draft?.to ?? [],
      draftCc: draft?.cc ?? [],
      draftInReplyTo: draft?.inReplyTo ?? null,
      updatedAt: new Date(),
    })
    .where(eq(agentDrafts.id, row.draftId));

  await logEmailAudit({
    userId: row.userId,
    action: "email_l2_regenerated",
    result: "success",
    resourceId: row.draftId,
    detail: {
      before: { action: row.action },
      after: { action: newAction },
      riskTier: row.riskTier,
      reasoning_locale_changed: reasoningLocaleChanged,
    },
  });

  return { status: "refreshed", draftId: row.draftId, reasoningLocaleChanged };
}

export async function regenerateAllOpenDrafts(
  userId: string,
  opts: { limit: number }
): Promise<RegenerateAllOutcome> {
  const limit = Math.max(1, Math.floor(opts.limit));
  const ids = await db
    .select({ id: agentDrafts.id })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.status, ["pending", "paused"])
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(limit + 1);

  const hasMore = ids.length > limit;
  const targets = hasMore ? ids.slice(0, limit) : ids;

  let refreshed = 0;
  let skipped = 0;
  let creditsExhausted = false;

  for (const { id } of targets) {
    try {
      const out = await regenerateDraft(id);
      if (out.status === "refreshed") refreshed++;
      else skipped++;
    } catch (err) {
      if (err instanceof BillingQuotaExceededError) {
        creditsExhausted = true;
        break;
      }
      Sentry.captureException(err, {
        tags: { feature: "email_regenerate", step: "regenerate_draft" },
        user: { id: userId },
        extra: { draftId: id },
      });
      try {
        await logEmailAudit({
          userId,
          action: "email_l2_regenerated",
          result: "failure",
          resourceId: id,
          detail: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // Audit failures must not abort the loop — the per-row regenerate
        // already happened (or didn't), and the loop is the unit of work.
      }
      skipped++;
    }
  }

  return {
    scanned: targets.length,
    refreshed,
    skipped,
    creditsExhausted,
    hasMore,
  };
}

// Heuristic: did the regenerated reasoning switch language vs. what we
// stored? Used only in the audit detail for downstream observability.
// Approximated by presence/absence of CJK characters since the locale
// surfaces post PR #168 are EN ↔ JA.
function isLocaleSwitch(
  before: string | null | undefined,
  after: string
): boolean {
  if (!before) return false;
  const cjk = /[　-鿿＀-￯]/;
  return cjk.test(before) !== cjk.test(after);
}
