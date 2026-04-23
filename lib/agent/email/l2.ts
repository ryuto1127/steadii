import "server-only";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  users,
  type AgentDraftStatus,
  type AgentDraftAction,
  type NewAgentDraft,
} from "@/lib/db/schema";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { selectModel } from "@/lib/agent/models";
import { runRiskPass, type RiskPassResult } from "./classify-risk";
import { runDeepPass, type DeepPassResult, type DeepAction } from "./classify-deep";
import { runDraft, type DraftResult } from "./draft";
import { searchSimilarEmails, DEEP_PASS_TOP_K } from "./retrieval";
import { buildEmbedInput } from "./embeddings";
import { logEmailAudit } from "./audit";

// A concise summary returned to the ingest caller — useful in logs + tests.
export type L2Outcome = {
  agentDraftId: string | null;
  status: AgentDraftStatus;
  action: AgentDraftAction | null;
  pausedAtStep: "risk" | "deep" | "draft" | null;
  riskTier: "low" | "medium" | "high" | null;
};

// Run the L2 pipeline for one inbox item. Risk → (deep if high) →
// (draft if action === 'draft_reply'). Each step gated by
// assertCreditsAvailable; if the gate throws BillingQuotaExceededError we
// persist a 'paused' draft row and bail cleanly.
//
// Memory (2026-04-23 C6): "Risk pass continues even when balance.exceeded
// (Mini is cheap). Deep pass + draft skipped when exhausted."
// assertCreditsAvailable is still called before risk pass for observability,
// but risk-pass failure mode is "skip the whole pipeline with paused=risk",
// which matches the UI semantics (inbox item exists; draft generation
// didn't happen).
export async function processL2(inboxItemId: string): Promise<L2Outcome> {
  return Sentry.startSpan(
    {
      name: "email.l2.pipeline",
      op: "gen_ai.pipeline",
      attributes: { "steadii.inbox_item_id": inboxItemId },
    },
    async () => runPipeline(inboxItemId)
  );
}

async function runPipeline(inboxItemId: string): Promise<L2Outcome> {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, inboxItemId))
    .limit(1);
  if (!item) {
    return {
      agentDraftId: null,
      status: "dismissed",
      action: null,
      pausedAtStep: null,
      riskTier: null,
    };
  }

  const [userRow] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, item.userId))
    .limit(1);

  await logEmailAudit({
    userId: item.userId,
    action: "email_l2_started",
    result: "success",
    resourceId: item.id,
  });

  // ---- Step 1: risk pass (Mini) ----
  let risk: RiskPassResult;
  try {
    await assertCreditsAvailable(item.userId);
    risk = await runRiskPass({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderDomain: item.senderDomain,
      senderRole: item.senderRole,
      subject: item.subject,
      snippet: item.snippet,
      firstTimeSender: item.firstTimeSender,
    });
  } catch (err) {
    if (err instanceof BillingQuotaExceededError) {
      return persistPaused({
        userId: item.userId,
        inboxItemId: item.id,
        step: "risk",
        riskTier: null,
        risk: null,
        deep: null,
      });
    }
    Sentry.captureException(err, {
      tags: { feature: "email_l2", step: "risk" },
      user: { id: item.userId },
      extra: { inboxItemId: item.id },
    });
    await logEmailAudit({
      userId: item.userId,
      action: "email_l2_failed",
      result: "failure",
      resourceId: item.id,
      detail: {
        step: "risk",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  const riskTier = risk.riskTier;

  // ---- Step 2: deep pass (Full, high-risk only) ----
  let deep: DeepPassResult | null = null;
  if (riskTier === "high") {
    try {
      await assertCreditsAvailable(item.userId);
    } catch (err) {
      if (err instanceof BillingQuotaExceededError) {
        return persistPaused({
          userId: item.userId,
          inboxItemId: item.id,
          step: "deep",
          riskTier,
          risk,
          deep: null,
        });
      }
      throw err;
    }

    const similarQuery = buildEmbedInput(item.subject, item.snippet);
    const { results: similar, totalCandidates } = similarQuery
      ? await searchSimilarEmails({
          userId: item.userId,
          queryText: similarQuery,
          topK: DEEP_PASS_TOP_K,
          excludeInboxItemId: item.id,
        })
      : { results: [], totalCandidates: 0 };

    deep = await runDeepPass({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderDomain: item.senderDomain,
      senderRole: item.senderRole,
      subject: item.subject,
      snippet: item.snippet,
      bodySnippet: item.snippet,
      riskPass: risk,
      similarEmails: similar,
      totalCandidates,
      threadRecentMessages: [],
    });
  }

  // ---- Decide action ----
  // Medium risk: we do NOT run the deep pass; we use the risk-pass reasoning
  // as our shallower read and attempt a draft. Action is implicitly
  // draft_reply for medium (the UI affords the user dismissal).
  // Low risk: no_op — inbox item stays visible but no draft generated.
  const decidedAction: DeepAction =
    riskTier === "high"
      ? deep?.action ?? "ask_clarifying"
      : riskTier === "medium"
      ? "draft_reply"
      : "no_op";

  let draft: DraftResult | null = null;
  if (decidedAction === "draft_reply") {
    // ---- Step 3: draft (Full) ----
    try {
      await assertCreditsAvailable(item.userId);
    } catch (err) {
      if (err instanceof BillingQuotaExceededError) {
        return persistPaused({
          userId: item.userId,
          inboxItemId: item.id,
          step: "draft",
          riskTier,
          risk,
          deep,
        });
      }
      throw err;
    }

    // Medium-risk drafts get thread context only. High-risk drafts reuse
    // the deep pass's similarEmails (if any).
    const similarForDraft =
      riskTier === "high" && deep
        ? deep.retrievalProvenance.sources.map((s) => ({
            inboxItemId: s.id,
            similarity: s.similarity,
            subject: null,
            snippet: s.snippet,
            receivedAt: new Date(0),
            senderEmail: "",
          }))
        : [];

    draft = await runDraft({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderName: item.senderName,
      senderRole: item.senderRole,
      subject: item.subject,
      snippet: item.snippet,
      bodySnippet: item.snippet,
      inReplyTo: null,
      threadRecentMessages: [],
      similarEmails: similarForDraft,
      userName: userRow?.name ?? null,
      userEmail: userRow?.email ?? null,
    });
  }

  const row: NewAgentDraft = {
    userId: item.userId,
    inboxItemId: item.id,
    classifyModel: selectModel(
      riskTier === "high" ? "email_classify_deep" : "email_classify_risk"
    ),
    draftModel: draft ? selectModel("email_draft") : null,
    riskPassUsageId: risk.usageId,
    deepPassUsageId: deep?.usageId ?? null,
    draftUsageId: draft?.usageId ?? null,
    riskTier,
    action: decidedAction,
    reasoning: deep?.reasoning ?? risk.reasoning,
    retrievalProvenance: deep?.retrievalProvenance ?? null,
    draftSubject: draft?.subject ?? null,
    draftBody: draft?.body ?? null,
    draftTo: draft?.to ?? [],
    draftCc: draft?.cc ?? [],
    draftInReplyTo: draft?.inReplyTo ?? null,
    status: "pending",
    pausedAtStep: null,
  };

  const [persisted] = await db.insert(agentDrafts).values(row).returning({
    id: agentDrafts.id,
  });

  // Update the inbox item's risk_tier — L2 has a final say.
  await db
    .update(inboxItems)
    .set({ riskTier, updatedAt: new Date() })
    .where(eq(inboxItems.id, item.id));

  await logEmailAudit({
    userId: item.userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: item.id,
    detail: {
      riskTier,
      action: decidedAction,
      deepPassCalled: !!deep,
      draftGenerated: !!draft,
      retrieval: deep?.retrievalProvenance
        ? {
            returned: deep.retrievalProvenance.returned,
            totalCandidates: deep.retrievalProvenance.total_candidates,
          }
        : null,
    },
  });

  return {
    agentDraftId: persisted?.id ?? null,
    status: "pending",
    action: decidedAction,
    pausedAtStep: null,
    riskTier,
  };
}

async function persistPaused(args: {
  userId: string;
  inboxItemId: string;
  step: "risk" | "deep" | "draft";
  riskTier: "low" | "medium" | "high" | null;
  risk: RiskPassResult | null;
  deep: DeepPassResult | null;
}): Promise<L2Outcome> {
  const row: NewAgentDraft = {
    userId: args.userId,
    inboxItemId: args.inboxItemId,
    classifyModel: args.risk ? selectModel("email_classify_risk") : null,
    draftModel: null,
    riskPassUsageId: args.risk?.usageId ?? null,
    deepPassUsageId: args.deep?.usageId ?? null,
    draftUsageId: null,
    // When paused at the risk step we have no classified tier. Safety bias:
    // log as medium so downstream UI defaults to review-required.
    riskTier: args.riskTier ?? "medium",
    action: "ask_clarifying",
    reasoning:
      args.deep?.reasoning ??
      args.risk?.reasoning ??
      "Credit quota exceeded before any L2 step completed.",
    retrievalProvenance: args.deep?.retrievalProvenance ?? null,
    draftSubject: null,
    draftBody: null,
    draftTo: [],
    draftCc: [],
    draftInReplyTo: null,
    status: "paused",
    pausedAtStep: args.step,
  };
  const [persisted] = await db.insert(agentDrafts).values(row).returning({
    id: agentDrafts.id,
  });
  await logEmailAudit({
    userId: args.userId,
    action: "email_l2_paused",
    result: "success",
    resourceId: args.inboxItemId,
    detail: {
      step: args.step,
      riskTier: args.riskTier,
    },
  });
  return {
    agentDraftId: persisted?.id ?? null,
    status: "paused",
    action: "ask_clarifying",
    pausedAtStep: args.step,
    riskTier: args.riskTier,
  };
}
