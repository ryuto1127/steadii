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
  type RuleProvenance,
} from "@/lib/db/schema";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { selectModel } from "@/lib/agent/models";
import { runRiskPass, type RiskPassResult } from "./classify-risk";
import { runDeepPass, type DeepPassResult, type DeepAction } from "./classify-deep";
import { runDraft, type DraftResult } from "./draft";
import { searchSimilarEmails, DEEP_PASS_TOP_K, type SimilarEmail } from "./retrieval";
import { buildEmbedInput } from "./embeddings";
import { fetchRecentThreadMessages } from "./thread";
import { logEmailAudit } from "./audit";

// Hand-tuned K for the shallower medium-risk draft retrieval. Smaller than
// DEEP_PASS_TOP_K because medium items don't get the deep reasoning pass,
// so we don't need the full 20-item slate — just enough style/tone
// anchoring for the draft.
const MEDIUM_DRAFT_TOP_K = 5;

// A concise summary returned to the ingest caller — useful in logs + tests.
export type L2Outcome = {
  agentDraftId: string | null;
  status: AgentDraftStatus;
  action: AgentDraftAction | null;
  pausedAtStep: "risk" | "deep" | "draft" | null;
  riskTier: "low" | "medium" | "high" | null;
};

// Options for invoking the pipeline.
//
// `forceTier` is used by L1 auto_high / auto_medium paths: the rule engine
// already decided the tier (internship offer, academic integrity,
// office-hour / deadline keyword, etc.) and that decision is strict — risk
// pass must not downgrade or upgrade it. We skip runRiskPass entirely,
// synthesize a RiskPassResult from the L1 rule provenance, and hand off to
// the tier-appropriate downstream step (deep pass for high, direct draft
// for medium).
export type ProcessL2Options = {
  forceTier?: "high" | "medium";
};

// Run the L2 pipeline for one inbox item.
//
// Memory (2026-04-23 C6): "Risk pass continues even when balance.exceeded
// (Mini is cheap). Deep pass + draft skipped when exhausted." We honour
// that literally: there is NO credit gate before the risk pass. Mini cost
// rounds to 0 credits per call so gating would block a free operation and
// rob exhausted users of their classification/reasoning visibility (which
// the glass-box UI depends on). The gate lives before deep and draft.
export async function processL2(
  inboxItemId: string,
  options: ProcessL2Options = {}
): Promise<L2Outcome> {
  return Sentry.startSpan(
    {
      name: "email.l2.pipeline",
      op: "gen_ai.pipeline",
      attributes: {
        "steadii.inbox_item_id": inboxItemId,
        "steadii.force_tier": options.forceTier ?? "none",
      },
    },
    async () => runPipeline(inboxItemId, options)
  );
}

async function runPipeline(
  inboxItemId: string,
  options: ProcessL2Options
): Promise<L2Outcome> {
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

  // ---- Step 1: risk pass (Mini, always runs — unless forceTier) ----
  //
  // forceTier means L1 already fired a strict auto_high / auto_medium rule.
  // Per memory "AUTO_HIGH — strict, L2 cannot downgrade" (and the symmetric
  // auto_medium intent: office-hour / deadline keyword hits are reply-worthy
  // by rule), we must not let the risk pass re-classify. Skip runRiskPass
  // entirely and synthesize a RiskPassResult from the stored rule_provenance
  // so the downstream steps + the Why-this-draft panel still see *which*
  // rule fired.
  let risk: RiskPassResult;
  if (options.forceTier === "high") {
    risk = synthesizeForcedHighRisk(item.ruleProvenance ?? []);
  } else if (options.forceTier === "medium") {
    risk = synthesizeForcedMediumRisk(item.ruleProvenance ?? []);
  } else {
    try {
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
  }

  const riskTier = risk.riskTier;

  // Prior thread messages (oldest-first, last 2) — cheap DB-only lookup
  // against our own inbox_items. Gmail API call would be accurate but adds
  // latency + external failure surface; using our materialized copy is
  // sufficient since we ingest every triaged message.
  const threadMessages = await fetchRecentThreadMessages({
    userId: item.userId,
    threadExternalId: item.threadExternalId,
    beforeReceivedAt: item.receivedAt,
    limit: 2,
  });

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
      threadRecentMessages: threadMessages,
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

    // High-risk drafts reuse the deep pass's retrieval (already paid for).
    // Medium-risk drafts pull a smaller top-K slate of similar emails to
    // anchor tone/style — shallower than deep pass, but not empty.
    let similarForDraft: SimilarEmail[] = [];
    if (riskTier === "high" && deep) {
      similarForDraft = deep.retrievalProvenance.sources.map((s) => ({
        inboxItemId: s.id,
        similarity: s.similarity,
        subject: null,
        snippet: s.snippet,
        receivedAt: new Date(0),
        senderEmail: "",
      }));
    } else if (riskTier === "medium") {
      const similarQuery = buildEmbedInput(item.subject, item.snippet);
      if (similarQuery) {
        const { results } = await searchSimilarEmails({
          userId: item.userId,
          queryText: similarQuery,
          topK: MEDIUM_DRAFT_TOP_K,
          excludeInboxItemId: item.id,
        });
        similarForDraft = results;
      }
    }

    draft = await runDraft({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderName: item.senderName,
      senderRole: item.senderRole,
      subject: item.subject,
      snippet: item.snippet,
      bodySnippet: item.snippet,
      inReplyTo: null,
      threadRecentMessages: threadMessages,
      similarEmails: similarForDraft,
      userName: userRow?.name ?? null,
      userEmail: userRow?.email ?? null,
    });
  }

  // The draft step can escalate from "I'll answer" to "I need to ask
  // back" when it spots ambiguity (subject/body conflict, missing date,
  // etc.). Honour that by overriding the action to ask_clarifying — same
  // body, same to/cc/subject, just framed as a question rather than an
  // answer. The Inbox UI already renders ask_clarifying differently.
  const finalAction: DeepAction =
    draft?.kind === "clarify" ? "ask_clarifying" : decidedAction;

  // When the draft chose to clarify, its reasoning is the user-relevant
  // one (it explains *why we asked instead of answered*). Otherwise keep
  // the existing deep > risk fallback chain.
  const finalReasoning =
    draft?.kind === "clarify"
      ? draft.reasoning
      : (deep?.reasoning ?? risk.reasoning);

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
    action: finalAction,
    reasoning: finalReasoning,
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
      action: finalAction,
      decidedAction,
      draftKind: draft?.kind ?? null,
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
    action: finalAction,
    pausedAtStep: null,
    riskTier,
  };
}

async function persistPaused(args: {
  userId: string;
  inboxItemId: string;
  step: "deep" | "draft";
  riskTier: "low" | "medium" | "high";
  risk: RiskPassResult;
  deep: DeepPassResult | null;
}): Promise<L2Outcome> {
  const row: NewAgentDraft = {
    userId: args.userId,
    inboxItemId: args.inboxItemId,
    classifyModel: selectModel("email_classify_risk"),
    draftModel: null,
    riskPassUsageId: args.risk.usageId,
    deepPassUsageId: args.deep?.usageId ?? null,
    draftUsageId: null,
    riskTier: args.riskTier,
    action: "paused",
    reasoning: args.deep?.reasoning ?? args.risk.reasoning,
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

  // Write the risk_tier back even on pause so downstream UI can filter /
  // style inbox items by tier regardless of whether the draft completed.
  await db
    .update(inboxItems)
    .set({ riskTier: args.riskTier, updatedAt: new Date() })
    .where(eq(inboxItems.id, args.inboxItemId));

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
    action: "paused",
    pausedAtStep: args.step,
    riskTier: args.riskTier,
  };
}

// Build a RiskPassResult for the AUTO_HIGH-forced path without calling the
// Mini risk-classifier. Pulls the firing L1 rule out of rule_provenance
// (prefer global AUTO_HIGH_* or the learned supervisor rule) so the deep
// pass and the "Why this draft" UI can cite *which* rule triggered.
// usageId is null because no token spend occurred.
function synthesizeForcedHighRisk(
  provenance: RuleProvenance[]
): RiskPassResult {
  const autoHighRule = provenance.find(
    (p) =>
      p.ruleId.startsWith("GLOBAL_AUTO_HIGH_") ||
      p.ruleId === "USER_AUTO_HIGH_SUPERVISOR"
  );
  const firstTimeRule = provenance.find(
    (p) => p.ruleId === "GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN"
  );
  const fired = autoHighRule ?? firstTimeRule;
  const ruleId = fired?.ruleId ?? "AUTO_HIGH";
  const why = fired?.why ?? "L1 rules placed this message in the AUTO_HIGH bucket.";
  return {
    riskTier: "high",
    confidence: 1.0,
    reasoning: `L1 auto_high rule: ${ruleId} — ${why}`,
    usageId: null,
  };
}

// Symmetric synthesizer for the AUTO_MEDIUM-forced path. Prefers global
// AUTO_MEDIUM_* keyword rules or the learned professor/TA rule so the draft
// step + Why-this-draft UI can cite the firing rule. No deep pass is run
// for medium tier — the reasoning here becomes the draft's provenance.
function synthesizeForcedMediumRisk(
  provenance: RuleProvenance[]
): RiskPassResult {
  const fired = provenance.find(
    (p) =>
      p.ruleId.startsWith("GLOBAL_AUTO_MEDIUM_") ||
      p.ruleId === "USER_AUTO_MEDIUM_PROFESSOR_TA"
  );
  const ruleId = fired?.ruleId ?? "AUTO_MEDIUM";
  const why = fired?.why ?? "L1 rules placed this message in the AUTO_MEDIUM bucket.";
  return {
    riskTier: "medium",
    confidence: 1.0,
    reasoning: `L1 auto_medium rule: ${ruleId} — ${why}`,
    usageId: null,
  };
}
