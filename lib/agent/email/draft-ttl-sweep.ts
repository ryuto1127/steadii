import "server-only";

// 2026-06-13 — Wave A noise reduction. Pending agent_drafts that the user
// never acts on must reach EMPTY on their own; otherwise the queue
// accumulates indefinitely. This sub-sweep ages out stale pending drafts
// SILENTLY — the underlying Gmail message is untouched and stays in the
// inbox (the real backstop), so high precision beats a visible restore.
//
// Two tiers:
//   - notify_only / low-value FYI drafts → 48h. These are informational
//     ("no action needed"); once they've sat 2 days unread they're noise.
//   - decision-required drafts (action draft_reply / ask_clarifying, OR
//     high/medium riskTier) → 5 days. A genuine decision shouldn't vanish
//     in 2 days, so this tier is a much longer backstop — it exists only
//     so the queue can't grow without bound, not to rush the user.
//
// "Age out" = set disposition='resolved' (reusing the existing canonical
// visibility signal the queue read path filters on) + a neutral audit-log
// entry. NO new column, NO visible "expired/aged" tag (silent), NO Gmail
// API call. The audit row carries detail.subAction='aged_out' + the tier
// so the silent retirement is observable without a schema change.
//
// SELECT-then-loop (not a single UPDATE) because each aged-out row writes
// its own per-user audit entry, and the tier decision depends on
// (action, riskTier) which is cheapest to evaluate in code. Bounded by
// `limit` so a backlog can't time out the cron; the partial
// agent_drafts_user_disposition_idx (disposition='active') keeps the
// candidate scan tight.

import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  agentDrafts,
  type AgentDraftAction,
  type InboxRiskTier,
} from "@/lib/db/schema";
import { logEmailAudit } from "./audit";

// FYI / notify-only drafts age out after 48h.
export const DRAFT_FYI_TTL_MS = 48 * 60 * 60 * 1000;
// Decision-required drafts get a 5-day backstop.
export const DRAFT_DECISION_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export type DraftTtlTier = "fyi" | "decision";

export type DraftTtlSweepResult = {
  scanned: number;
  agedOut: number;
  // Split so the cron summary / tests can confirm both tiers fire.
  agedOutFyi: number;
  agedOutDecision: number;
};

// Pure tier predicate — exported for unit coverage so the tier split can
// be tested without the DB chain. A draft is "decision-required" (longer
// TTL) when it needs a real user decision: a reply / clarifying answer,
// or anything the risk pass flagged high/medium. Everything else (a
// low-risk notify_only FYI) is the short-TTL tier.
export function draftTtlTier(row: {
  action: AgentDraftAction;
  riskTier: InboxRiskTier;
}): DraftTtlTier {
  if (row.action === "draft_reply" || row.action === "ask_clarifying") {
    return "decision";
  }
  if (row.riskTier === "high" || row.riskTier === "medium") {
    return "decision";
  }
  return "fyi";
}

// Pure age-out predicate — exported for unit coverage. True when the
// draft's createdAt is older than its tier's TTL relative to `now`.
export function isDraftAgedOut(
  row: {
    action: AgentDraftAction;
    riskTier: InboxRiskTier;
    createdAt: Date;
  },
  now: Date,
): boolean {
  const tier = draftTtlTier(row);
  const ttlMs = tier === "fyi" ? DRAFT_FYI_TTL_MS : DRAFT_DECISION_TTL_MS;
  return now.getTime() - row.createdAt.getTime() >= ttlMs;
}

export async function runDraftTtlSweep(args: {
  // ms epoch for "now" — Date.now() in prod, fixed value in tests.
  nowMs: number;
  // Cap on rows processed per sweep so a backlog can't time out the cron.
  limit?: number;
}): Promise<DraftTtlSweepResult> {
  const { nowMs, limit = 200 } = args;
  const now = new Date(nowMs);

  // Candidate set: live pending drafts. The shortest TTL is 48h, so we
  // can prune anything created within the last 48h at the DB level —
  // nothing newer than that is age-out-eligible in EITHER tier. The
  // tier/age decision then runs in code on the remaining rows.
  const oldestEligibleCreatedAt = new Date(nowMs - DRAFT_FYI_TTL_MS);

  const rows = await db
    .select({
      id: agentDrafts.id,
      userId: agentDrafts.userId,
      action: agentDrafts.action,
      riskTier: agentDrafts.riskTier,
      createdAt: agentDrafts.createdAt,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.status, "pending"),
        eq(agentDrafts.disposition, "active"),
        inArray(agentDrafts.action, [
          "draft_reply",
          "ask_clarifying",
          "notify_only",
        ]),
        lt(agentDrafts.createdAt, oldestEligibleCreatedAt),
      ),
    )
    .orderBy(asc(agentDrafts.createdAt))
    .limit(limit);

  let agedOutFyi = 0;
  let agedOutDecision = 0;

  for (const row of rows) {
    if (!isDraftAgedOut(row, now)) continue;
    const tier = draftTtlTier(row);
    try {
      await db
        .update(agentDrafts)
        .set({ disposition: "resolved", updatedAt: now })
        .where(eq(agentDrafts.id, row.id));
      // Neutral audit entry — reuses the existing email_l2_completed
      // action (no new enum value / migration). The subAction +tier make
      // the silent retirement forensically observable.
      await logEmailAudit({
        userId: row.userId,
        action: "email_l2_completed",
        result: "success",
        resourceId: row.id,
        detail: { subAction: "aged_out", tier },
      });
      if (tier === "fyi") agedOutFyi++;
      else agedOutDecision++;
    } catch (err) {
      // Per-row failure is logged + skipped, never fatal — one bad row
      // must not block the rest of the backlog.
      Sentry.captureException(err, {
        tags: { feature: "draft_ttl", phase: "age_out" },
        user: { id: row.userId },
        extra: { draftId: row.id },
      });
    }
  }

  return {
    scanned: rows.length,
    agedOut: agedOutFyi + agedOutDecision,
    agedOutFyi,
    agedOutDecision,
  };
}
