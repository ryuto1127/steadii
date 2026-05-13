import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConfirmations,
  agentContactPersonas,
  agentDrafts,
  agentRules,
  inboxItems,
  users,
  type AgentDraftStatus,
  type AgentDraftAction,
  type ContactStructuredFacts,
  type NewAgentDraft,
  type RuleProvenance,
} from "@/lib/db/schema";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { selectModel } from "@/lib/agent/models";
import { runRiskPass, type RiskPassResult } from "./classify-risk";
import {
  buildProvenance,
  runDeepPass,
  type DeepPassResult,
  type DeepAction,
} from "./classify-deep";
import {
  runAgenticL2,
  type AgenticL2Result,
} from "./agentic-l2";
import { runDraft, type DraftResult } from "./draft";
import { searchSimilarEmails, DEEP_PASS_TOP_K, type SimilarEmail } from "./retrieval";
import { buildEmbedInput } from "./embeddings";
import { fetchRecentThreadMessages } from "./thread";
import { logEmailAudit } from "./audit";
import { fanoutForInbox, type FanoutResult } from "./fanout";
import { loadRecentFeedbackSummary } from "./feedback";
import { getUserLocale, getUserTimezone } from "@/lib/agent/preferences";
import { inferSenderTzFromDomain } from "./sender-timezone-heuristic";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import { extractEmailBody } from "./body-extract";
import {
  fetchUpcomingEvents,
  type DraftCalendarEvent,
} from "@/lib/integrations/google/calendar";
import { enqueueSendForDraft } from "./send-enqueue";
import { getPromotionState } from "@/lib/agent/learning/sender-confidence";
import { resolveEntitiesInBackground } from "@/lib/agent/entity-graph/resolver";

// Hand-tuned K for the shallower medium-risk draft retrieval. Smaller than
// DEEP_PASS_TOP_K because medium items don't get the deep reasoning pass,
// so we don't need the full 20-item slate — just enough style/tone
// anchoring for the draft.
const MEDIUM_DRAFT_TOP_K = 5;

// 2026-05-11 — L2 used to pass `inbox_items.snippet` (~120 char Gmail
// preview) as the email body to runDeepPass + runDraft. Structured
// emails (interview scheduling, official notices) have their substance
// past the snippet boundary so Steadii literally couldn't see the
// candidate dates / form fields / etc. Fetch the full body once at L2
// entry, cap at this size to keep token cost predictable, pass through
// to both phases.
const FULL_BODY_CHAR_CAP = 8000;

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
  // engineer-45 — when the user submits freeText through a Type E
  // ask_clarifying card, we re-run L2 against the same inbox item with
  // their clarification threaded into the agentic-L2 user message. The
  // loop then re-decides the action (typically: drafts a reply that
  // uses the clarification as authoritative input). Empty / undefined
  // when the re-run path isn't being used.
  userClarification?: string;
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
    .select({
      email: users.email,
      name: users.name,
      autonomySendEnabled: users.autonomySendEnabled,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, item.userId))
    .limit(1);

  await logEmailAudit({
    userId: item.userId,
    action: "email_l2_started",
    result: "success",
    resourceId: item.id,
  });

  // 2026-05-11 — fetch the full Gmail body once at L2 entry. Replaces
  // the snippet-only path that was leaving structured emails (interview
  // scheduling, official notices) effectively unread to L2 / draft.
  // Fail-soft: a Gmail outage falls back to the snippet so the
  // pipeline degrades to the prior behavior instead of failing.
  let fullBodyText: string | null = null;
  if (item.sourceType === "gmail") {
    try {
      const message = await getMessageFull(item.userId, item.externalId);
      const extracted = extractEmailBody(message);
      const raw = (extracted.text ?? "").trim();
      if (raw.length > 0) {
        fullBodyText =
          raw.length > FULL_BODY_CHAR_CAP
            ? raw.slice(0, FULL_BODY_CHAR_CAP)
            : raw;
      }
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "email_l2", step: "fetch_full_body" },
        user: { id: item.userId },
        extra: { inboxItemId: item.id },
      });
    }
  }
  const bodyForPipeline = fullBodyText ?? item.snippet;

  // ---- Step 1: risk pass (Mini, always runs — unless forceTier) ----
  //
  // forceTier means L1 already fired a strict auto_high / auto_medium rule.
  // Per memory "AUTO_HIGH — strict, L2 cannot downgrade" (and the symmetric
  // auto_medium intent: office-hour / deadline keyword hits are reply-worthy
  // by rule), we must not let the risk pass re-classify. Skip runRiskPass
  // entirely and synthesize a RiskPassResult from the stored rule_provenance
  // so the downstream steps + the Why-this-draft panel still see *which*
  // rule fired.
  // Phase 7 W1 — multi-source fanout. Runs once at the start of the L2
  // pipeline so the same context is reused across risk, deep, and draft.
  // Fail-soft: errors degrade to a null fanout (the prompts then render
  // exactly the pre-W1 shape so the pipeline never blocks on retrieval).
  let fanoutForRisk: FanoutResult | null = null;
  if (!options.forceTier) {
    try {
      fanoutForRisk = await fanoutForInbox({
        userId: item.userId,
        inboxItemId: item.id,
        phase: "classify",
        subject: item.subject,
        snippet: item.snippet,
        senderEmail: item.senderEmail,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_l2", step: "fanout_classify" },
        user: { id: item.userId },
      });
    }
  }

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
        fanout: fanoutForRisk,
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
  let fanoutForDeep: FanoutResult | null = null;
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

    // Re-fetch fanout for the deep phase so the email source bumps to
    // K=20 and the calendar window widens from 3 to 7 days. Mistakes /
    // syllabus rows are stable between phases — re-fetching keeps the
    // pipeline stateless and the per-phase audit log clean.
    try {
      fanoutForDeep = await fanoutForInbox({
        userId: item.userId,
        inboxItemId: item.id,
        phase: "deep",
        subject: item.subject,
        snippet: item.snippet,
        senderEmail: item.senderEmail,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_l2", step: "fanout_deep" },
        user: { id: item.userId },
      });
    }

    // Reuse fanout's email source as the deep-pass similar slate. Falls
    // back to the legacy direct call when fanout failed entirely.
    let similar: SimilarEmail[] = fanoutForDeep?.similarEmails ?? [];
    let totalCandidates = fanoutForDeep?.totalSimilarCandidates ?? 0;
    if (!fanoutForDeep) {
      const similarQuery = buildEmbedInput(item.subject, item.snippet);
      if (similarQuery) {
        const r = await searchSimilarEmails({
          userId: item.userId,
          queryText: similarQuery,
          topK: DEEP_PASS_TOP_K,
          excludeInboxItemId: item.id,
        });
        similar = r.results;
        totalCandidates = r.totalCandidates;
      }
    }

    // polish-7 — per-user feedback prior. Read once at deep-pass time
    // so the prompt sees the student's revealed preference for this
    // sender. Returns null on read failure or when no rows exist; the
    // prompt then renders unchanged from the pre-polish-7 shape.
    const recentFeedback = await loadRecentFeedbackSummary({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderDomain: item.senderDomain,
    });

    // 2026-05-06 — thread the user's app locale through to the deep
    // pass so reasoning is generated in JA for JA users (the
    // draft-details panel surfaces it user-visibly post PR #167).
    const locale = await getUserLocale(item.userId);

    // engineer-41 — Agentic L2 branch. Opt-in via users.preferences.agenticL2.
    // When on, swap the single-shot runDeepPass for the tool-using
    // runAgenticL2. Both produce the same DeepPassResult contract for
    // the rest of the pipeline; agentic also writes structured-facts +
    // confirmation rows that we persist below.
    const agenticEnabled =
      userRow?.preferences?.agenticL2 === true;
    let agenticResult: AgenticL2Result | null = null;
    if (agenticEnabled) {
      try {
        agenticResult = await runAgenticL2({
          userId: item.userId,
          inboxItemId: item.id,
          senderEmail: item.senderEmail,
          senderDomain: item.senderDomain,
          senderRole: item.senderRole,
          subject: item.subject,
          bodyForPipeline: bodyForPipeline ?? "",
          riskPass: risk,
          locale,
          userClarification: options.userClarification ?? null,
        });
        deep = {
          action: agenticResult.action,
          reasoning: agenticResult.reasoning,
          actionItems: agenticResult.actionItems,
          shortSummary: agenticResult.shortSummary,
          retrievalProvenance: buildProvenance({
            similarEmails: similar,
            totalCandidates,
            fanout: fanoutForDeep,
          }),
          usageId: agenticResult.usageId,
        };
      } catch (err) {
        // Failure inside the agentic loop should NOT block the L2
        // pipeline. Fall back to the single-shot deep pass so the user
        // still gets a draft.
        Sentry.captureException(err, {
          tags: { feature: "email_l2", step: "agentic_l2" },
          user: { id: item.userId },
          extra: { inboxItemId: item.id },
        });
        agenticResult = null;
      }
    }
    if (!agenticResult) {
      deep = await runDeepPass({
        userId: item.userId,
        senderEmail: item.senderEmail,
        senderDomain: item.senderDomain,
        senderRole: item.senderRole,
        subject: item.subject,
        snippet: item.snippet,
        bodySnippet: bodyForPipeline,
        riskPass: risk,
        similarEmails: similar,
        totalCandidates,
        threadRecentMessages: threadMessages,
        fanout: fanoutForDeep,
        recentFeedback,
        locale,
      });
    } else {
      // Persist inferred-facts + confirmation rows produced by the
      // agentic loop. Done in fire-and-forget style so persistence
      // failures don't fail the pipeline (the draft is still useful).
      try {
        await persistAgenticSideEffects({
          userId: item.userId,
          senderEmail: item.senderEmail,
          result: agenticResult,
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "email_l2", step: "agentic_side_effects" },
          user: { id: item.userId },
        });
      }
    }
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
  let fanoutForDraft: FanoutResult | null = fanoutForDeep;
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

    // Phase 7 W1 — fanout for the draft phase. High-risk drafts can reuse
    // fanoutForDeep when it's already populated (same shape, same caps);
    // medium-risk drafts run a fresh fanout with classify-sized email K
    // bumped to draft window.
    if (!fanoutForDraft) {
      try {
        fanoutForDraft = await fanoutForInbox({
          userId: item.userId,
          inboxItemId: item.id,
          phase: "draft",
          subject: item.subject,
          snippet: item.snippet,
          senderEmail: item.senderEmail,
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "email_l2", step: "fanout_draft" },
          user: { id: item.userId },
        });
      }
    }

    let similarForDraft: SimilarEmail[] = [];
    if (fanoutForDraft) {
      similarForDraft = fanoutForDraft.similarEmails;
    } else if (riskTier === "medium") {
      // Fanout failed — fall back to the legacy direct similar-email pull
      // so the prompt still gets a tone/style anchor.
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

    // Legacy calendar slot — only populated when fanout failed entirely.
    // Fanout's own calendar block (events + Google Tasks) is the primary
    // path. We still fetch live calendar events here as a fallback so a
    // fanout failure doesn't strip the agent of availability grounding.
    let calendarEvents: DraftCalendarEvent[] = [];
    if (!fanoutForDraft) {
      try {
        calendarEvents = await fetchUpcomingEvents(item.userId, { days: 7 });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "email_l2", step: "calendar_fetch" },
          user: { id: item.userId },
        });
      }
    }

    // engineer-38 — voice profile + writing-style rules. Voice is read
    // from users.preferences; style rules come from agent_rules with
    // scope='writing_style' (populated by the daily style-learner cron).
    // Both are user-scoped — no cross-user leakage. Failures degrade to
    // empty / null so the draft path never blocks on a learner outage.
    const voiceProfile =
      typeof userRow?.preferences?.voiceProfile === "string"
        ? userRow.preferences.voiceProfile
        : null;
    let writingStyleRules: string[] = [];
    try {
      const ruleRows = await db
        .select({ matchValue: agentRules.matchValue, reason: agentRules.reason })
        .from(agentRules)
        .where(
          and(
            eq(agentRules.userId, item.userId),
            eq(agentRules.scope, "writing_style"),
            eq(agentRules.enabled, true),
            isNull(agentRules.deletedAt)
          )
        );
      // The rule sentence lives in `reason` (matchValue is "*" for the
      // global writing-style scope). Older insertions might use either
      // — fall back gracefully so a one-row data shape drift can't
      // strip an entire user's prompt block.
      writingStyleRules = ruleRows
        .map((r) => (r.reason ?? r.matchValue ?? "").trim())
        .filter((r) => r.length > 0 && r !== "*");
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_l2", step: "writing_style_rules" },
        user: { id: item.userId },
      });
    }

    // engineer-45 — thread the student's TZ + the sender's domain-
    // inferred TZ into the draft prompt so the dual-TZ rendering rule
    // can fire when the two differ. The domain heuristic is the cheap
    // first pass; the agentic L2 path may have already overwritten
    // the persona with a more confident inference, but for the draft
    // we only need a usable hint — the prompt skips dual-rendering
    // when senderTz is null.
    const studentTz = await getUserTimezone(item.userId);
    const senderTzHint = inferSenderTzFromDomain(item.senderDomain);

    draft = await runDraft({
      userId: item.userId,
      senderEmail: item.senderEmail,
      senderName: item.senderName,
      senderRole: item.senderRole,
      subject: item.subject,
      snippet: item.snippet,
      bodySnippet: bodyForPipeline,
      inReplyTo: null,
      threadRecentMessages: threadMessages,
      similarEmails: similarForDraft,
      calendarEvents,
      fanout: fanoutForDraft,
      voiceProfile,
      writingStyleRules,
      userName: userRow?.name ?? null,
      userEmail: userRow?.email ?? null,
      userTimezone: studentTz,
      senderTimezone: senderTzHint.tz,
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

  // Phase 7 W1 — provenance for medium-tier drafts. The deep pass already
  // emits its own retrievalProvenance via buildProvenance(input.fanout).
  // For medium tier (no deep), build the same shape from the draft-phase
  // fanout so the inbox-detail UI can render typed pills for those rows.
  const mediumTierProvenance =
    riskTier === "medium" && fanoutForDraft
      ? buildProvenance({
          similarEmails: fanoutForDraft.similarEmails,
          totalCandidates: fanoutForDraft.totalSimilarCandidates,
          fanout: fanoutForDraft,
        })
      : null;

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
    retrievalProvenance:
      deep?.retrievalProvenance ?? mediumTierProvenance ?? null,
    // engineer-39 — surface the deep pass's structured to-dos onto the
    // draft row so the inbox detail page can render the "N action
    // items detected" section. The deep pass already filtered to high-
    // confidence items; the UI does its own MIN_ACTION_ITEM_CONFIDENCE
    // sanity floor on render. Empty array on medium-tier paths and on
    // pause/no_op rows; that's the correct behavior — there's no deep
    // reasoning to mine for obligations.
    extractedActionItems: deep?.actionItems ?? [],
    // engineer-43 — surface the notify_only content summary onto the
    // draft row so the queue Type C card body carries it. Only set when
    // the deep pass actually returned one (notify_only path); null on
    // every other action so the Type C body falls back to the generic
    // copy.
    shortSummary: deep?.shortSummary ?? null,
    draftSubject: draft?.subject ?? null,
    draftBody: draft?.body ?? null,
    // engineer-38 — freeze the LLM-first body. saveDraftEditsAction will
    // overwrite draftBody with the user's edit; this column stays put so
    // recordSenderFeedback can compute (original, final) at send time.
    originalDraftBody: draft?.body ?? null,
    draftTo: draft?.to ?? [],
    draftCc: draft?.cc ?? [],
    draftInReplyTo: draft?.inReplyTo ?? null,
    status: "pending",
    pausedAtStep: null,
  };

  const [persisted] = await db.insert(agentDrafts).values(row).returning({
    id: agentDrafts.id,
  });

  // engineer-51 — entity resolution on the L2-finished draft body. L2's
  // full-body deep pass often surfaces entities the inbox-snippet pass
  // missed (a recruiter's company name buried below the greeting, a
  // project codename in the third paragraph). Fire-and-forget — failure
  // doesn't block the auto-send / queue flow.
  if (persisted && draft?.body) {
    resolveEntitiesInBackground({
      userId: item.userId,
      sourceKind: "agent_draft",
      sourceId: persisted.id,
      contentText: [
        item.subject ?? "",
        draft.body ?? "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      knownContext: {
        senderEmail: item.senderEmail,
        classId: item.classId,
        sourceHint: "agent draft (L2 output)",
      },
    });
  }

  // W4.3 staged-autonomy auto-send. When the user has opted in AND the
  // draft is eligible, enqueue it directly into send_queue with the
  // standard 10s undo. Eligibility today: medium tier + draft_reply +
  // a complete draft (to/subject/body present). Failures are swallowed
  // — auto-send is a nicety; the draft is already persisted in pending
  // state so the worst case is the user sees a normal review queue
  // entry instead of an auto-sent one.
  //
  // engineer-49 — dynamic confirmation thresholds. Layer the learned
  // per-sender promotion state on top of the static gate:
  //   - promotionState='auto_send' → bypass the medium-tier-only gate
  //     so high-tier drafts can also auto-send from a trusted sender,
  //     gated only on autonomy_send_enabled + complete draft.
  //   - promotionState='always_review' → force autoSendEligible=false
  //     even when the static gate would have passed (medium + opted in).
  const draftComplete =
    !!persisted &&
    finalAction === "draft_reply" &&
    draft?.kind === "draft" &&
    !!draft.body &&
    !!draft.subject &&
    draft.to.length > 0;
  const promotionState = draftComplete
    ? await getPromotionState({
        userId: item.userId,
        senderEmail: item.senderEmail,
        actionType: finalAction,
      })
    : "baseline";
  const baseEligible =
    draftComplete &&
    !!userRow?.autonomySendEnabled &&
    riskTier === "medium";
  const promotedEligible =
    draftComplete &&
    !!userRow?.autonomySendEnabled &&
    promotionState === "auto_send";
  const autoSendEligible =
    promotionState !== "always_review" &&
    (baseEligible || promotedEligible);
  if (autoSendEligible) {
    try {
      await enqueueSendForDraft({
        userId: item.userId,
        draftId: persisted.id,
        isAutomatic: true,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_l2", step: "auto_send" },
        user: { id: item.userId },
        extra: { draftId: persisted.id },
      });
    }
  }

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

// engineer-41 — write back agentic-L2 side effects:
//   1. Update agent_confirmations rows we just queued with
//      originatingDraftId once the draft row exists (deferred — for
//      now we just leave them associated by userId + createdAt window
//      since draft persistence happens later in the pipeline).
//   2. Merge inferredFacts onto agent_contact_personas.structured_facts.
//      Uses Postgres jsonb || concatenation to leave existing facts
//      intact while overwriting only the topics the loop touched.
export async function persistAgenticSideEffects(args: {
  userId: string;
  senderEmail: string;
  result: AgenticL2Result;
}): Promise<void> {
  const factsToWrite: ContactStructuredFacts = {};
  for (const f of args.result.inferredFacts) {
    if (
      f.topic !== "timezone" &&
      f.topic !== "response_window_hours" &&
      f.topic !== "primary_language"
    ) {
      continue;
    }
    const entry = {
      value: f.value,
      confidence: f.confidence,
      source: "llm_body_analysis" as const,
      samples: 0,
      confirmedAt: null,
    };
    if (f.topic === "primary_language") {
      const v = f.value.toLowerCase();
      if (v === "ja" || v === "en") {
        factsToWrite.primary_language = {
          ...entry,
          value: v as "en" | "ja",
        };
      }
    } else if (f.topic === "timezone") {
      factsToWrite.timezone = entry;
    } else if (f.topic === "response_window_hours") {
      factsToWrite.response_window_hours = entry;
    }
  }
  if (Object.keys(factsToWrite).length === 0) return;

  await db
    .insert(agentContactPersonas)
    .values({
      userId: args.userId,
      contactEmail: args.senderEmail.toLowerCase(),
      contactName: null,
      relationship: null,
      facts: [],
      structuredFacts: factsToWrite,
      lastExtractedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agentContactPersonas.userId, agentContactPersonas.contactEmail],
      set: {
        structuredFacts: sql`COALESCE(${agentContactPersonas.structuredFacts}, '{}'::jsonb) || ${JSON.stringify(factsToWrite)}::jsonb`,
        updatedAt: new Date(),
      },
    });

  // Defensive — keep the agentConfirmations / agentContactPersonas
  // imports referenced even when no facts were written.
  void agentConfirmations;
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
