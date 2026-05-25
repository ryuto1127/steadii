import "server-only";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems, users, agentRules, type InboxItem } from "@/lib/db/schema";
import { logEmailAudit } from "./audit";
import { AUTO_ARCHIVE_CONFIDENCE_THRESHOLD } from "./rules";
import type { TriageResult } from "./types";

// Wave 5 + Round 4 (2026-05-24) — auto-archive Tier 1.
//
// Round 4 converts this from act-first to PROPOSE-FIRST per
// `project_consent_first_principle.md`. Three eligibility gates still
// fire in series (failing any one keeps the row visible and unflagged):
//
//   1. user.auto_archive_enabled — Settings toggle. Defaults false during
//      the α 2-week safety ramp. Now relabeled "Suggest archiving low-
//      risk emails" in the UI to reflect the propose semantics; the
//      column name + default behavior stay the same.
//   2. result.bucket === 'auto_low' — only the lowest L1 bucket qualifies.
//   3. result.confidence ≥ AUTO_ARCHIVE_CONFIDENCE_THRESHOLD (0.95) AND
//      !result.learnedOptOut — the user hasn't restored a previous
//      similar item.
//
// On all-pass the row is NOT archived. Instead:
//   - inbox_items.proposed_archive_at is stamped to now()
//   - inbox_items.proposed_archive_reason captures the gate values
//   - audit_log row tagged 'auto_archive_proposed' fires
//
// The user sees a Type-H queue card asking them to confirm a batch
// archive across all currently-proposed items. On confirm, the
// queue-actions module flips status='archived'+auto_archived=true and
// writes the existing 'auto_archive' audit_log row (preserving its
// downstream consumers — digest, Hidden filter chip, etc.). On
// dismiss the proposed flags clear and the items stay in inbox.
// Untouched proposals are cleared by the propose-archive-expiry cron
// sub-sweep after 7 days.

/**
 * Returns true when the env-controlled default for new users is on.
 * Sparring flips `AUTO_ARCHIVE_DEFAULT_ENABLED=true` via a tiny
 * follow-up PR after the 2-week α validation window. Used by signup
 * code paths and whenever we need to know "what would the default be
 * for a fresh user today" — the user's persisted toggle is still the
 * source of truth once they exist.
 */
export function autoArchiveDefaultEnabled(): boolean {
  // Read env directly (not via the typed env() helper) because this is
  // a feature ramp flag, not a service credential — it ships unset and
  // the absence of the var means "off". Truthiness covers "true" / "1"
  // / "yes".
  const v = process.env.AUTO_ARCHIVE_DEFAULT_ENABLED;
  if (!v) return false;
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Pure decision — does this triage result qualify for auto-archive
 * given the user's settings? Pulled out so tests can drive each gate
 * independently without spinning up a DB.
 *
 * Round 4: the function's contract is unchanged — it still answers
 * "is this row eligible for the auto-archive flow?". The downstream
 * effect changed from "silently archive" to "propose for user
 * confirmation", but the gate values are identical.
 */
export function isAutoArchiveEligible(
  result: TriageResult,
  userPrefs: { autoArchiveEnabled: boolean }
): boolean {
  if (!userPrefs.autoArchiveEnabled) return false;
  if (result.bucket !== "auto_low") return false;
  if (result.learnedOptOut) return false;
  return result.confidence >= AUTO_ARCHIVE_CONFIDENCE_THRESHOLD;
}

/**
 * Build the reason string stamped onto inbox_items.proposed_archive_reason.
 * Captures the L1 gate values so an admin or future audit reviewer can
 * trace the propose back to its inputs without joining audit_log.
 * Format is intentionally short + structured so it fits in a text
 * column without sprawl.
 */
export function buildProposeArchiveReason(result: TriageResult): string {
  return `Tier1 ${result.bucket} conf=${result.confidence.toFixed(2)} learned_opt_out=${result.learnedOptOut}`;
}

/**
 * Side-effecting: load user prefs, decide, propose + audit. Called by
 * `applyTriageResult` after the row insert. Failures are logged but
 * never propagated — the row is already created; proposal failing
 * just means it stays visible without the flag (the safe fallback).
 *
 * Round 4 rename: was `maybeAutoArchive` (act-first). The action is
 * now "propose" (set proposed_archive_at) rather than "archive". The
 * caller in `triage.ts` was updated to the new name in the same PR.
 */
export async function maybeProposeAutoArchive(
  userId: string,
  item: InboxItem,
  result: TriageResult
): Promise<{ proposed: boolean }> {
  try {
    const [u] = await db
      .select({ autoArchiveEnabled: users.autoArchiveEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return { proposed: false };
    if (!isAutoArchiveEligible(result, u)) return { proposed: false };

    const reason = buildProposeArchiveReason(result);
    await db
      .update(inboxItems)
      .set({
        proposedArchiveAt: new Date(),
        proposedArchiveReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, item.id));

    await logEmailAudit({
      userId,
      action: "auto_archive_proposed",
      result: "success",
      resourceId: item.id,
      detail: {
        bucket: result.bucket,
        confidence: result.confidence,
        senderEmail: item.senderEmail,
        senderDomain: item.senderDomain,
        subject: item.subject,
        senderRole: result.senderRole,
        reason,
      },
    });
    return { proposed: true };
  } catch (err) {
    // Audit-log the failure so admin can see the rate. Don't throw —
    // one bad item must not poison the ingest loop.
    try {
      await logEmailAudit({
        userId,
        action: "auto_archive_failed",
        result: "failure",
        resourceId: item.id,
        detail: {
          message: err instanceof Error ? err.message : String(err),
          phase: "propose",
        },
      });
    } catch {
      // audit is best-effort
    }
    return { proposed: false };
  }
}

// Restore a previously auto-archived item. Round 4 leaves this path
// untouched — once a user has confirmed an archive, the restore flow
// + learned-rule insertion are the same as Wave 5. Only the path
// from detector → archive shifted to propose-first.
//
// Two effects:
//   1. Flip status back to 'open', clear auto_archived flag, stamp
//      user_restored_at so future analytics can attribute restores.
//   2. Insert a learned agent_rules row scoped to the sender's email
//      with risk_tier='medium' so future similar items don't qualify
//      for auto-archive (learnedOptOut catches them in the classifier).
//
// Caller (the Inbox restore action) is responsible for auth — this
// function trusts the userId/itemId pair.
export async function restoreFromAutoArchive(
  userId: string,
  inboxItemId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, inboxItemId))
    .limit(1);
  if (!item) return { ok: false, reason: "not_found" };
  if (item.userId !== userId) return { ok: false, reason: "wrong_user" };
  if (!item.autoArchived)
    return { ok: false, reason: "not_auto_archived" };

  await db
    .update(inboxItems)
    .set({
      status: "open",
      autoArchived: false,
      userRestoredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(inboxItems.id, inboxItemId));

  // Learning signal — the user told us this sender is more important
  // than auto_low. Inserting a learned rule with risk_tier='medium'
  // flips `learnedOptOut` to true on future ingests for this sender,
  // which short-circuits the auto-archive gate. agent_rules has no
  // unique constraint on (user_id, scope, match_normalized), so we
  // probe + branch (insert vs update) instead of upsert.
  const senderEmail = item.senderEmail.toLowerCase();
  const candidates = await db
    .select({
      id: agentRules.id,
      scope: agentRules.scope,
      matchNormalized: agentRules.matchNormalized,
      riskTier: agentRules.riskTier,
    })
    .from(agentRules)
    .where(eq(agentRules.userId, userId));
  const existingRule = candidates.find(
    (r) => r.scope === "sender" && r.matchNormalized === senderEmail
  );

  if (existingRule) {
    if (existingRule.riskTier !== "medium" && existingRule.riskTier !== "high") {
      await db
        .update(agentRules)
        .set({
          riskTier: "medium",
          enabled: true,
          reason: "User restored auto-hidden item",
          updatedAt: new Date(),
        })
        .where(eq(agentRules.id, existingRule.id));
    }
  } else {
    await db.insert(agentRules).values({
      userId,
      scope: "sender",
      matchValue: item.senderEmail,
      matchNormalized: senderEmail,
      riskTier: "medium",
      source: "learned",
      reason: "User restored auto-hidden item",
      enabled: true,
    });
  }

  await logEmailAudit({
    userId,
    action: "auto_archive_restored",
    result: "success",
    resourceId: inboxItemId,
    detail: {
      senderEmail: item.senderEmail,
      learnedRuleScope: "sender",
    },
  });

  return { ok: true };
}

// Used by the cron's propose-archive-expiry sub-sweep — defined here
// (rather than in the cron module) so the propose / expire pair lives
// together. Clears `proposed_archive_at` (and the reason) on rows
// whose proposal is older than `staleAfterMs`. Items stay visible in
// the inbox; no archive happens. Per-user audit row carries the
// count and the cleared ids so admin can correlate sweeps to actions
// taken (or, in this case, NOT taken).
export async function expireStaleProposedArchives(args: {
  nowMs: number;
  // Default 7 days. Pass an explicit value in tests for determinism.
  staleAfterMs?: number;
}): Promise<{ scanned: number; cleared: number }> {
  const staleAfterMs = args.staleAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(args.nowMs - staleAfterMs);
  const stale = await db
    .select({ id: inboxItems.id, userId: inboxItems.userId })
    .from(inboxItems)
    .where(
      and(
        isNotNull(inboxItems.proposedArchiveAt),
        lt(inboxItems.proposedArchiveAt, cutoff),
      ),
    );
  if (stale.length === 0) return { scanned: 0, cleared: 0 };

  // Group by user so the audit log carries a single batch row per user
  // (matches the dismiss-batch pattern in queue-actions).
  const perUser = new Map<string, string[]>();
  for (const row of stale) {
    const arr = perUser.get(row.userId);
    if (arr) arr.push(row.id);
    else perUser.set(row.userId, [row.id]);
  }

  let cleared = 0;
  const now = new Date();
  for (const [userId, ids] of perUser) {
    for (const id of ids) {
      await db
        .update(inboxItems)
        .set({
          proposedArchiveAt: null,
          proposedArchiveReason: null,
          updatedAt: now,
        })
        .where(eq(inboxItems.id, id));
      cleared++;
    }
    try {
      await logEmailAudit({
        userId,
        action: "auto_archive_proposal_expired",
        result: "success",
        resourceId: null,
        detail: { count: ids.length, inboxItemIds: ids },
      });
    } catch {
      // best-effort
    }
  }
  return { scanned: stale.length, cleared };
}
