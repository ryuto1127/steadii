import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentRules,
  inboxItems,
  users,
  type AgentDraftAction,
  type ExtractedActionItem,
  type RetrievalProvenance,
} from "@/lib/db/schema";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { selectModel } from "@/lib/agent/models";
import {
  buildProvenance,
  runDeepPass,
  type DeepPassResult,
} from "./classify-deep";
import { runDraft, type DraftResult } from "./draft";
import { fetchRecentThreadMessages } from "./thread";
import { logEmailAudit } from "./audit";
import { fanoutForInbox, type FanoutResult } from "./fanout";
import { loadRecentFeedbackSummary } from "./feedback";
import { getUserLocale } from "@/lib/agent/preferences";
import {
  runAgenticL2,
  type AgenticL2Result,
} from "./agentic-l2";
import { persistAgenticSideEffects } from "./l2";
import type { RiskPassResult } from "./classify-risk";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import { extractEmailBody } from "./body-extract";

// 2026-05-12 — full-body cap mirrored from l2.ts. Regenerate fetches the
// same Gmail body the normal ingest path does so the agentic loop sees
// the same context (PR #193 wired this for fresh ingest; regenerate was
// left on snippet-only and quietly degraded the dogfood signal).
const FULL_BODY_CHAR_CAP = 8000;

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
      sourceType: inboxItems.sourceType,
      externalId: inboxItems.externalId,
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
    .select({
      email: users.email,
      name: users.name,
      preferences: users.preferences,
    })
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

  // 2026-05-12 — mirror l2.ts's full-body fetch so the agentic loop (and
  // the legacy deep pass) see the same context the normal ingest path
  // sees. Fail-soft: a Gmail outage degrades to the snippet rather than
  // failing the regeneration.
  let fullBodyText: string | null = null;
  if (row.sourceType === "gmail") {
    try {
      const message = await getMessageFull(row.userId, row.externalId);
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
        tags: { feature: "email_regenerate", step: "fetch_full_body" },
        user: { id: row.userId },
        extra: { draftId, inboxItemId: row.inboxItemId },
      });
    }
  }
  const bodyForPipeline = fullBodyText ?? row.snippet;

  let fanout: FanoutResult | null = null;
  let newReasoning = row.reasoning ?? "";
  let newAction: AgentDraftAction = row.action;
  let newRetrievalProvenance: RetrievalProvenance | null = null;
  // engineer-39 — action items refresh in lockstep with the deep pass.
  // Medium-tier paths skip the deep pass entirely so this stays empty
  // there (mirroring l2.ts), and the row's stale items get cleared so
  // a regeneration that drops to medium tier doesn't strand the prior
  // high-tier extraction.
  let newActionItems: ExtractedActionItem[] = [];
  let draft: DraftResult | null = null;

  if (row.riskTier === "high") {
    try {
      fanout = await fanoutForInbox({
        userId: row.userId,
        inboxItemId: row.inboxItemId,
        phase: "deep",
        subject: row.subject,
        snippet: row.snippet,
        senderEmail: row.senderEmail,
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

    // Risk pass is intentionally NOT re-run — synthesize a minimal
    // RiskPassResult from the stored tier so the downstream prompt
    // sees a "Tier: high" header. The original reasoning is reused
    // as a placeholder for the risk-pass reasoning slot; it is
    // overwritten on the row by the new deep reasoning we compute
    // immediately below.
    const syntheticRiskPass: RiskPassResult = {
      riskTier: "high",
      confidence: 1.0,
      reasoning: row.reasoning ?? "(prior risk reasoning unavailable)",
      usageId: null,
    };

    // 2026-05-12 — agentic L2 branch. Mirrors l2.ts so the Regenerate
    // admin button honors users.preferences.agenticL2 the same way
    // the normal ingest path does. Without this mirror, Regenerate
    // silently runs the legacy single-shot runDeepPass even for
    // agentic-opted-in users, so it couldn't be used to dogfood the
    // agentic loop over existing inbox items.
    const agenticEnabled =
      userRow?.preferences?.agenticL2 === true;
    let agenticResult: AgenticL2Result | null = null;
    let deep: DeepPassResult | null = null;
    if (agenticEnabled) {
      try {
        agenticResult = await runAgenticL2({
          userId: row.userId,
          inboxItemId: row.inboxItemId,
          senderEmail: row.senderEmail,
          senderDomain: row.senderDomain,
          senderRole: row.senderRole,
          subject: row.subject,
          bodyForPipeline: bodyForPipeline ?? "",
          riskPass: syntheticRiskPass,
          locale,
        });
        deep = {
          action: agenticResult.action,
          reasoning: agenticResult.reasoning,
          actionItems: agenticResult.actionItems,
          shortSummary: agenticResult.shortSummary,
          retrievalProvenance: buildProvenance({
            similarEmails: fanout?.similarEmails ?? [],
            totalCandidates: fanout?.totalSimilarCandidates ?? 0,
            fanout,
          }),
          usageId: agenticResult.usageId,
        };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "email_regenerate", step: "agentic_l2" },
          user: { id: row.userId },
          extra: { draftId, inboxItemId: row.inboxItemId },
        });
        agenticResult = null;
      }
    }
    if (!agenticResult) {
      deep = await runDeepPass({
        userId: row.userId,
        senderEmail: row.senderEmail,
        senderDomain: row.senderDomain,
        senderRole: row.senderRole,
        subject: row.subject,
        snippet: row.snippet,
        bodySnippet: bodyForPipeline,
        riskPass: syntheticRiskPass,
        similarEmails: fanout?.similarEmails ?? [],
        totalCandidates: fanout?.totalSimilarCandidates ?? 0,
        threadRecentMessages: threadMessages,
        fanout,
        recentFeedback,
        locale,
      });
    } else {
      try {
        await persistAgenticSideEffects({
          userId: row.userId,
          senderEmail: row.senderEmail,
          result: agenticResult,
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "email_regenerate", step: "agentic_side_effects" },
          user: { id: row.userId },
        });
      }
    }

    newReasoning = deep!.reasoning;
    newAction = deep!.action;
    newRetrievalProvenance = deep!.retrievalProvenance;
    newActionItems = deep!.actionItems;
  } else {
    try {
      fanout = await fanoutForInbox({
        userId: row.userId,
        inboxItemId: row.inboxItemId,
        phase: "draft",
        subject: row.subject,
        snippet: row.snippet,
        senderEmail: row.senderEmail,
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
    // engineer-38 — voice profile + writing-style rules (mirrors l2.ts
    // path so regenerated drafts get the same prompt context as fresh
    // ones).
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
            eq(agentRules.userId, row.userId),
            eq(agentRules.scope, "writing_style"),
            eq(agentRules.enabled, true),
            isNull(agentRules.deletedAt)
          )
        );
      writingStyleRules = ruleRows
        .map((r) => (r.reason ?? r.matchValue ?? "").trim())
        .filter((r) => r.length > 0 && r !== "*");
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_regenerate", step: "writing_style_rules" },
        user: { id: row.userId },
      });
    }
    draft = await runDraft({
      userId: row.userId,
      senderEmail: row.senderEmail,
      senderName: row.senderName,
      senderRole: row.senderRole,
      subject: row.subject,
      snippet: row.snippet,
      bodySnippet: bodyForPipeline,
      inReplyTo: null,
      threadRecentMessages: threadMessages,
      similarEmails: fanout?.similarEmails ?? [],
      // Legacy calendar-events array — fanout's calendar block already
      // covers events + tasks for both tiers, so this stays empty.
      calendarEvents: [],
      fanout,
      voiceProfile,
      writingStyleRules,
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
      // engineer-39 — refresh extracted items + drop accepted indices
      // since items list may have shifted. Future-friendly: a simple
      // "accept again" flow is cheaper than a fragile title-match
      // dedup across regeneration boundaries.
      extractedActionItems: newActionItems,
      acceptedActionItemIndices: [],
      classifyModel:
        row.riskTier === "high"
          ? selectModel("email_classify_deep")
          : selectModel("email_classify_risk"),
      draftModel: draft ? selectModel("email_draft") : null,
      draftSubject: draft?.subject ?? null,
      draftBody: draft?.body ?? null,
      // engineer-38 — refresh the LLM-first body snapshot. Regenerate
      // overwrites the prior LLM body with a new one, so the
      // edit-delta baseline must follow.
      originalDraftBody: draft?.body ?? null,
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
  // 2026-05-12 — tier filter at the SELECT layer. The per-row branch
  // inside regenerateDraft already skips low/null tiers (they have no
  // L2 output to refresh), but without filtering here the SELECT burns
  // its `limit` budget on rows that will be skipped — producing the
  // "Regenerated 3 drafts. More queued" message even when there's
  // literally nothing left actionable in the inbox.
  const ids = await db
    .select({ id: agentDrafts.id })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.status, ["pending", "paused"]),
        inArray(agentDrafts.riskTier, ["high", "medium"])
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
