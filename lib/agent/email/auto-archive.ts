import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems, users, agentRules, type InboxItem } from "@/lib/db/schema";
import { logEmailAudit } from "./audit";
import { AUTO_ARCHIVE_CONFIDENCE_THRESHOLD } from "./rules";
import type { TriageResult } from "./types";

// Wave 5 — auto-archive the lowest-risk inbox items so a real-secretary
// experience emerges (Steadii filters noise without surfacing it). Three
// gates fire in series; failing any one keeps the row visible:
//
//   1. user.auto_archive_enabled — Settings toggle. Defaults false during
//      the α 2-week safety ramp. Tiny follow-up PR flips the default
//      after the validation window per project_wave_5_design.md.
//   2. result.bucket === 'auto_low' — only the lowest L1 bucket qualifies.
//   3. result.confidence ≥ AUTO_ARCHIVE_CONFIDENCE_THRESHOLD (0.95) AND
//      !result.learnedOptOut — the user hasn't restored a previous
//      similar item.
//
// On a successful auto-archive the row's status flips to 'archived' and
// `auto_archived` is set true; an audit_log row tagged `auto_archive`
// fires (also surfaces in the Home Recent activity footer + the Inbox
// Hidden filter chip + the digest extension).

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
 * Side-effecting: load user prefs, decide, archive + audit. Called by
 * `applyTriageResult` after the row insert. Failures are logged but
 * never propagated — the row is already created; auto-archive failing
 * just means it stays visible (the safe fallback).
 */
export async function maybeAutoArchive(
  userId: string,
  item: InboxItem,
  result: TriageResult
): Promise<{ archived: boolean }> {
  try {
    const [u] = await db
      .select({ autoArchiveEnabled: users.autoArchiveEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return { archived: false };
    if (!isAutoArchiveEligible(result, u)) return { archived: false };

    await db
      .update(inboxItems)
      .set({
        status: "archived",
        autoArchived: true,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, item.id));

    await logEmailAudit({
      userId,
      action: "auto_archive",
      result: "success",
      resourceId: item.id,
      detail: {
        bucket: result.bucket,
        confidence: result.confidence,
        senderEmail: item.senderEmail,
        senderDomain: item.senderDomain,
        subject: item.subject,
        senderRole: result.senderRole,
      },
    });
    return { archived: true };
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
        },
      });
    } catch {
      // audit is best-effort
    }
    return { archived: false };
  }
}

/**
 * Restore a previously auto-archived item. Two effects:
 *   1. Flip status back to 'open', clear auto_archived flag, stamp
 *      user_restored_at so future analytics can attribute restores.
 *   2. Insert a learned agent_rules row scoped to the sender's email
 *      with risk_tier='medium' so future similar items don't qualify
 *      for auto-archive (learnedOptOut catches them in the classifier).
 *
 * Caller (the Inbox restore action) is responsible for auth — this
 * function trusts the userId/itemId pair.
 */
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
