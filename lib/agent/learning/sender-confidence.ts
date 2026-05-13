import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditLog,
  senderConfidence,
  users,
  type AgentDraftAction,
  type SenderConfidenceRow,
  type SenderConfidencePromotionState,
} from "@/lib/db/schema";

// engineer-49 — central state machine for the dynamic-confirmation
// learner. Three responsibilities:
//   1. `recordSenderEvent()` — increment counts / streaks on every
//      approve / dismiss / edit / reject. Called from the same server
//      actions that already write `agent_sender_feedback` rows so the
//      raw event log and the rolled-up state stay in lockstep.
//   2. `evaluatePromotion()` — recompute confidence + decide whether
//      the (user, sender, action) row should auto_send / always_review /
//      stay baseline. Runs inline after every event.
//   3. `getPromotionState()` — fast read for the L2 fast path. Returns
//      'baseline' when no row exists (untouched senders).
//
// Failures are swallowed: the learner is a quality nicety, never block
// the user's Send/Dismiss because we couldn't update a counter.

// Sample floor — confidence stays near 0.5 baseline when fewer than this
// many samples exist (per the handoff). Prevents promoting on a 1-of-1
// approval streak.
const CONFIDENCE_SAMPLE_FLOOR = 5;

// Each edited row counts as a fractional positive: the user trusted the
// agent enough to send but corrected the body, so it's a partial signal.
const EDIT_POSITIVE_WEIGHT = 0.3;

// Auto-promote to auto_send when ALL of these are true.
const PROMOTE_CONSECUTIVE_APPROVALS = 5;
const PROMOTE_CONFIDENCE_THRESHOLD = 0.85;

// Auto-demote thresholds. Either condition is sufficient.
const DEMOTE_CONSECUTIVE_DISMISSALS = 3;
const DEMOTE_REJECTED_COUNT = 2;
const REJECT_WINDOW_DAYS = 30;

export type SenderEventKind =
  | "approved"   // user clicked Send (or auto-send fired)
  | "edited"     // user sent BUT edited the body first
  | "dismissed"  // user dismissed
  | "rejected";  // user explicitly flagged "don't send things like this"

// Normalize so the unique index can match. Same approach as
// recordSenderFeedback (lowercased denormalized sender column).
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Clamp confidence to [0, 1].
function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Compute the cached confidence from the row's counters. Matches the
// formula in the handoff: edited counts as 0.3 positive (so 5 edited-
// but-sent ≈ 1.5 effective positives); rejected is a hard-negative ≈ 1
// dismissal; sample floor of 5 prevents premature promotion.
export function computeConfidence(
  approvedCount: number,
  editedCount: number,
  dismissedCount: number,
  rejectedCount: number
): number {
  const editedWeighted = editedCount * EDIT_POSITIVE_WEIGHT;
  const positive = approvedCount + editedWeighted;
  const total =
    approvedCount + dismissedCount + rejectedCount + editedWeighted;
  if (total === 0) return 0.5;
  const denom = Math.max(total, CONFIDENCE_SAMPLE_FLOOR);
  return clamp01(positive / denom);
}

// Side-effect-free decision: given the next counter state, what should
// the promotion be? Exported for the tests.
//
// `rejectedCountInWindow` is the count of rejects within the trailing
// 30 days. The cumulative `rejectedCount` on the row is separate and
// preserved as history; this argument is what drives the demote rule.
//
// `autoSendOk` gates the auto_send branch — the user has to have
// autonomy_send_enabled globally for ANY auto-promotion to fire. Off-by-
// default per the locked decision in `project_agent_model.md`.
export function decidePromotion(args: {
  approvedCount: number;
  editedCount: number;
  dismissedCount: number;
  rejectedCount: number;
  rejectedCountInWindow: number;
  consecutiveApprovedCount: number;
  consecutiveDismissedCount: number;
  learnedConfidence: number;
  actionType: AgentDraftAction;
  autoSendOk: boolean;
  currentState: SenderConfidencePromotionState;
}): {
  state: SenderConfidencePromotionState;
  reason: string | null;
} {
  // Demote branches come first so a fresh reject immediately re-elevates
  // even mid-streak. Hard-negative beats soft-positive.
  if (args.consecutiveDismissedCount >= DEMOTE_CONSECUTIVE_DISMISSALS) {
    return {
      state: "always_review",
      reason: `consecutive_dismissed:${args.consecutiveDismissedCount}`,
    };
  }
  if (args.rejectedCountInWindow >= DEMOTE_REJECTED_COUNT) {
    return {
      state: "always_review",
      reason: `rejected_in_30d:${args.rejectedCountInWindow}`,
    };
  }

  // Promotion is restricted to draft_reply per the locked rule:
  // notify_only / ask_clarifying never auto-send. autoSendOk gates the
  // global toggle.
  if (
    args.actionType === "draft_reply" &&
    args.autoSendOk &&
    args.consecutiveApprovedCount >= PROMOTE_CONSECUTIVE_APPROVALS &&
    args.learnedConfidence >= PROMOTE_CONFIDENCE_THRESHOLD &&
    args.rejectedCountInWindow === 0
  ) {
    return {
      state: "auto_send",
      reason: `streak:${args.consecutiveApprovedCount}_conf:${args.learnedConfidence.toFixed(2)}`,
    };
  }

  // No active promotion / demotion signal. Once promoted, we don't
  // silently revert to baseline on every event — the user has to
  // explicitly revoke via the tuning page. The exception: a user
  // currently in always_review who hasn't been rejected within the
  // window AND has resumed approving freely stays in always_review
  // until they click Forgive (matches the handoff's "Lock until user
  // manually clears via settings" rule for rejects).
  return { state: args.currentState, reason: null };
}

// Count rejects within the trailing 30 days. Reads the row directly
// since `last_rejected_at` is denormalized — caller pre-knows if the
// last reject was within the window. For cumulative-count semantics in
// the demote rule we need an actual count, not just the latest.
//
// Implementation note: we use the cumulative `rejected_count` on the
// row as a proxy when `last_rejected_at` is inside the 30d window; when
// the most recent reject is older than 30 days we treat the in-window
// count as 0. This avoids a separate scan over `agent_sender_feedback`
// just to derive the rolling count — accuracy is good enough since the
// demote rule only fires when an in-window event lands.
function rejectedCountInWindow(
  row: SenderConfidenceRow,
  now: Date
): number {
  if (!row.lastRejectedAt) return 0;
  const windowFloor = new Date(
    now.getTime() - REJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  if (row.lastRejectedAt < windowFloor) return 0;
  return row.rejectedCount;
}

// Upsert the row, increment the relevant counters, recompute
// confidence, decide promotion, audit-log on state change. Returns the
// updated row (or null on swallow path) so callers can react if needed.
export async function recordSenderEvent(args: {
  userId: string;
  senderEmail: string;
  actionType: AgentDraftAction;
  event: SenderEventKind;
}): Promise<SenderConfidenceRow | null> {
  const senderEmail = normalizeEmail(args.senderEmail);
  if (!senderEmail) return null;
  const now = new Date();

  try {
    // Insert-or-update upsert. ON CONFLICT updates the relevant counter
    // + recomputes streak resets + cached confidence is recomputed after
    // the row is read back.
    const baseRow = {
      userId: args.userId,
      senderEmail,
      actionType: args.actionType,
      approvedCount: 0,
      editedCount: 0,
      dismissedCount: 0,
      rejectedCount: 0,
      consecutiveApprovedCount: 0,
      consecutiveDismissedCount: 0,
      learnedConfidence: 0.5,
      promotionState: "baseline" as SenderConfidencePromotionState,
    };
    const inserted = baseRow;
    switch (args.event) {
      case "approved":
        inserted.approvedCount = 1;
        inserted.consecutiveApprovedCount = 1;
        break;
      case "edited":
        // 'edited' is fired *in addition* to 'approved' from the send-
        // execute path when the user's final body diverged from the
        // LLM's first draft. Bumps editedCount only — streak deltas
        // already happened in the preceding 'approved' call.
        inserted.editedCount = 1;
        break;
      case "dismissed":
        inserted.dismissedCount = 1;
        inserted.consecutiveDismissedCount = 1;
        break;
      case "rejected":
        inserted.rejectedCount = 1;
        // Reject also breaks the approve streak.
        inserted.consecutiveDismissedCount = 1;
        break;
    }

    await db
      .insert(senderConfidence)
      .values({
        ...inserted,
        lastRejectedAt: args.event === "rejected" ? now : null,
      })
      .onConflictDoUpdate({
        target: [
          senderConfidence.userId,
          senderConfidence.senderEmail,
          senderConfidence.actionType,
        ],
        // buildUpdateSet returns a Record<string, unknown> so drizzle's
        // narrower .set typing won't fight the sql-fragment increments.
        set: buildUpdateSet(args.event, now) as Partial<
          typeof senderConfidence.$inferInsert
        >,
      });

    // Read the row back to compute confidence + decide promotion.
    const [row] = await db
      .select()
      .from(senderConfidence)
      .where(
        and(
          eq(senderConfidence.userId, args.userId),
          eq(senderConfidence.senderEmail, senderEmail),
          eq(senderConfidence.actionType, args.actionType)
        )
      )
      .limit(1);
    if (!row) return null;

    const newConfidence = computeConfidence(
      row.approvedCount,
      row.editedCount,
      row.dismissedCount,
      row.rejectedCount
    );

    // Pull autonomySendEnabled so the promote branch can gate on the
    // global toggle. One round-trip but cheap.
    const [userRow] = await db
      .select({ autonomySendEnabled: users.autonomySendEnabled })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);

    const inWindow = rejectedCountInWindow(row, now);
    const decision = decidePromotion({
      approvedCount: row.approvedCount,
      editedCount: row.editedCount,
      dismissedCount: row.dismissedCount,
      rejectedCount: row.rejectedCount,
      rejectedCountInWindow: inWindow,
      consecutiveApprovedCount: row.consecutiveApprovedCount,
      consecutiveDismissedCount: row.consecutiveDismissedCount,
      learnedConfidence: newConfidence,
      actionType: row.actionType,
      autoSendOk: !!userRow?.autonomySendEnabled,
      currentState: row.promotionState,
    });

    const stateChanged = decision.state !== row.promotionState;
    const update: Partial<typeof senderConfidence.$inferInsert> = {
      learnedConfidence: newConfidence,
      updatedAt: now,
    };
    if (stateChanged) {
      update.promotionState = decision.state;
      update.promotionLockedAt = now;
      update.promotionLockedReason = decision.reason;
    }
    await db
      .update(senderConfidence)
      .set(update)
      .where(eq(senderConfidence.id, row.id));

    if (stateChanged) {
      const auditAction =
        decision.state === "auto_send"
          ? "sender_confidence_promoted"
          : decision.state === "always_review"
            ? "sender_confidence_demoted"
            : "sender_confidence_reset";
      try {
        await db.insert(auditLog).values({
          userId: args.userId,
          action: auditAction,
          resourceType: "sender_confidence",
          resourceId: row.id,
          toolName: null,
          result: "success",
          detail: {
            senderEmail,
            actionType: row.actionType,
            previousState: row.promotionState,
            newState: decision.state,
            reason: decision.reason,
            learnedConfidence: newConfidence,
            consecutiveApprovedCount: row.consecutiveApprovedCount,
            consecutiveDismissedCount: row.consecutiveDismissedCount,
            rejectedCountInWindow: inWindow,
          },
        });
      } catch (auditErr) {
        Sentry.captureException(auditErr, {
          tags: { feature: "sender_confidence", op: "audit" },
          user: { id: args.userId },
        });
      }
    }

    return { ...row, learnedConfidence: newConfidence, promotionState: decision.state };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "sender_confidence", op: "record_event" },
      user: { id: args.userId },
      extra: { event: args.event, senderEmail },
    });
    return null;
  }
}

// SQL fragments for the ON CONFLICT update. Each event increments the
// relevant counter + resets the *opposing* streak. Edited bumps the
// approve streak (they did send), not the dismiss streak. Reject breaks
// the approve streak AND stamps last_rejected_at.
//
// Returns `Record<string, unknown>` because drizzle's update sets accept
// both raw values AND `sql<...>` fragments; the narrower
// `Partial<$inferInsert>` types only the value side and rejects the
// SQL-fragment increments.
function buildUpdateSet(
  event: SenderEventKind,
  now: Date
): Record<string, unknown> {
  switch (event) {
    case "approved":
      return {
        approvedCount: sql`${senderConfidence.approvedCount} + 1`,
        consecutiveApprovedCount: sql`${senderConfidence.consecutiveApprovedCount} + 1`,
        consecutiveDismissedCount: 0,
        updatedAt: now,
      };
    case "edited":
      // editedCount-only bump. Caller fires this *after* 'approved' on
      // a send-with-edit, so the streak/consec deltas are already done.
      return {
        editedCount: sql`${senderConfidence.editedCount} + 1`,
        updatedAt: now,
      };
    case "dismissed":
      return {
        dismissedCount: sql`${senderConfidence.dismissedCount} + 1`,
        consecutiveDismissedCount: sql`${senderConfidence.consecutiveDismissedCount} + 1`,
        consecutiveApprovedCount: 0,
        updatedAt: now,
      };
    case "rejected":
      return {
        rejectedCount: sql`${senderConfidence.rejectedCount} + 1`,
        consecutiveDismissedCount: sql`${senderConfidence.consecutiveDismissedCount} + 1`,
        consecutiveApprovedCount: 0,
        lastRejectedAt: now,
        updatedAt: now,
      };
  }
}

// Fast read for the L2 fast path. Returns the promotion state (or
// 'baseline' when no row exists) so the auto-send eligibility gate can
// branch without re-reading any other table.
export async function getPromotionState(args: {
  userId: string;
  senderEmail: string;
  actionType: AgentDraftAction;
}): Promise<SenderConfidencePromotionState> {
  const senderEmail = normalizeEmail(args.senderEmail);
  if (!senderEmail) return "baseline";
  try {
    const [row] = await db
      .select({ promotionState: senderConfidence.promotionState })
      .from(senderConfidence)
      .where(
        and(
          eq(senderConfidence.userId, args.userId),
          eq(senderConfidence.senderEmail, senderEmail),
          eq(senderConfidence.actionType, args.actionType)
        )
      )
      .limit(1);
    return row?.promotionState ?? "baseline";
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "sender_confidence", op: "get_promotion_state" },
      user: { id: args.userId },
    });
    return "baseline";
  }
}

// List rows by promotion state for the tuning page. Filters out
// baseline so the UI's two main sections don't render the long tail of
// untouched senders.
export async function listSenderConfidenceByState(args: {
  userId: string;
  state: SenderConfidencePromotionState;
}): Promise<SenderConfidenceRow[]> {
  return db
    .select()
    .from(senderConfidence)
    .where(
      and(
        eq(senderConfidence.userId, args.userId),
        eq(senderConfidence.promotionState, args.state)
      )
    );
}

// List "pending" rows — rows with 2-4 samples that haven't crossed
// promotion or demotion thresholds yet. Used by the tuning page's
// "Pending learning" section so the user can see where the learner is
// leaning.
export async function listPendingLearningRows(
  userId: string
): Promise<SenderConfidenceRow[]> {
  const rows = await db
    .select()
    .from(senderConfidence)
    .where(
      and(
        eq(senderConfidence.userId, userId),
        eq(senderConfidence.promotionState, "baseline")
      )
    );
  return rows.filter((r) => {
    const total =
      r.approvedCount + r.editedCount + r.dismissedCount + r.rejectedCount;
    return total >= 2 && total < CONFIDENCE_SAMPLE_FLOOR;
  });
}

// Revoke a promotion → flip back to baseline. Used by the tuning page's
// "Revoke" button. Reads the row, writes the new state + audit row.
// Returns true on success, false if no row matched.
export async function revokePromotion(args: {
  userId: string;
  senderEmail: string;
  actionType: AgentDraftAction;
}): Promise<boolean> {
  const senderEmail = normalizeEmail(args.senderEmail);
  const now = new Date();
  const result = await db
    .update(senderConfidence)
    .set({
      promotionState: "baseline",
      promotionLockedAt: now,
      promotionLockedReason: "user_revoke",
      updatedAt: now,
    })
    .where(
      and(
        eq(senderConfidence.userId, args.userId),
        eq(senderConfidence.senderEmail, senderEmail),
        eq(senderConfidence.actionType, args.actionType)
      )
    )
    .returning({ id: senderConfidence.id });
  if (result.length > 0) {
    try {
      await db.insert(auditLog).values({
        userId: args.userId,
        action: "sender_confidence_revoked",
        resourceType: "sender_confidence",
        resourceId: result[0].id,
        toolName: null,
        result: "success",
        detail: {
          senderEmail,
          actionType: args.actionType,
        },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "sender_confidence", op: "audit_revoke" },
        user: { id: args.userId },
      });
    }
  }
  return result.length > 0;
}

// "Forgive" — flip an always_review back to baseline AND reset the
// rejected_count + lastRejectedAt so the demote rule doesn't re-fire on
// the next event. The accumulated approvedCount / streak / etc. are
// preserved as history.
export async function forgiveSender(args: {
  userId: string;
  senderEmail: string;
  actionType: AgentDraftAction;
}): Promise<boolean> {
  const senderEmail = normalizeEmail(args.senderEmail);
  const now = new Date();
  const result = await db
    .update(senderConfidence)
    .set({
      promotionState: "baseline",
      promotionLockedAt: now,
      promotionLockedReason: "user_forgive",
      rejectedCount: 0,
      lastRejectedAt: null,
      consecutiveDismissedCount: 0,
      updatedAt: now,
    })
    .where(
      and(
        eq(senderConfidence.userId, args.userId),
        eq(senderConfidence.senderEmail, senderEmail),
        eq(senderConfidence.actionType, args.actionType)
      )
    )
    .returning({ id: senderConfidence.id });
  if (result.length > 0) {
    try {
      await db.insert(auditLog).values({
        userId: args.userId,
        action: "sender_confidence_forgiven",
        resourceType: "sender_confidence",
        resourceId: result[0].id,
        toolName: null,
        result: "success",
        detail: {
          senderEmail,
          actionType: args.actionType,
        },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "sender_confidence", op: "audit_forgive" },
        user: { id: args.userId },
      });
    }
  }
  return result.length > 0;
}

// Reset all rows for a user. Destructive — clears every learned
// signal. Used by the tuning page's "Reset all" button. Returns the
// count of deleted rows.
export async function resetAllSenderConfidence(
  userId: string
): Promise<number> {
  const result = await db
    .delete(senderConfidence)
    .where(eq(senderConfidence.userId, userId))
    .returning({ id: senderConfidence.id });
  if (result.length > 0) {
    try {
      await db.insert(auditLog).values({
        userId,
        action: "sender_confidence_reset_all",
        resourceType: "sender_confidence",
        result: "success",
        detail: { deletedCount: result.length },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "sender_confidence", op: "audit_reset_all" },
        user: { id: userId },
      });
    }
  }
  return result.length;
}

// Monthly summary for the boundary-review card body. Counts approve /
// dismiss / reject in the trailing 30 days + the current promotion-
// state counts. Used by both the proactive rule and the tuning page
// header.
export async function getMonthlySummary(args: {
  userId: string;
  now?: Date;
}): Promise<{
  approvedThisMonth: number;
  dismissedThisMonth: number;
  rejectedThisMonth: number;
  autoSendCount: number;
  alwaysReviewCount: number;
}> {
  const now = args.now ?? new Date();
  const floor = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(senderConfidence)
    .where(eq(senderConfidence.userId, args.userId));

  let approvedThisMonth = 0;
  let dismissedThisMonth = 0;
  let rejectedThisMonth = 0;
  let autoSendCount = 0;
  let alwaysReviewCount = 0;

  for (const r of rows) {
    if (r.promotionState === "auto_send") autoSendCount++;
    if (r.promotionState === "always_review") alwaysReviewCount++;
    // For the monthly counts we use updatedAt as the freshness proxy
    // (the row is touched on every event). If the row was touched in
    // the past 30d, attribute its cumulative deltas to "this month."
    // This is approximate but matches the user's mental model — the
    // raw per-event timestamps live in agent_sender_feedback.
    if (r.updatedAt && r.updatedAt >= floor) {
      approvedThisMonth += r.approvedCount;
      dismissedThisMonth += r.dismissedCount;
      rejectedThisMonth += r.rejectedCount;
    }
  }

  return {
    approvedThisMonth,
    dismissedThisMonth,
    rejectedThisMonth,
    autoSendCount,
    alwaysReviewCount,
  };
}

// Lighter-weight version used by the proactive rule's snapshot. Uses
// a single round-trip and returns counts only — no per-row dump.
export async function getMonthlySummaryCounts(
  userId: string,
  now: Date
): Promise<{
  approvedThisMonth: number;
  dismissedThisMonth: number;
  rejectedThisMonth: number;
  autoSendCount: number;
  alwaysReviewCount: number;
  hasAnyRow: boolean;
}> {
  const floor = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      approvedCount: senderConfidence.approvedCount,
      dismissedCount: senderConfidence.dismissedCount,
      rejectedCount: senderConfidence.rejectedCount,
      promotionState: senderConfidence.promotionState,
      updatedAt: senderConfidence.updatedAt,
    })
    .from(senderConfidence)
    .where(eq(senderConfidence.userId, userId));

  let approvedThisMonth = 0;
  let dismissedThisMonth = 0;
  let rejectedThisMonth = 0;
  let autoSendCount = 0;
  let alwaysReviewCount = 0;

  for (const r of rows) {
    if (r.promotionState === "auto_send") autoSendCount++;
    if (r.promotionState === "always_review") alwaysReviewCount++;
    if (r.updatedAt && r.updatedAt >= floor) {
      approvedThisMonth += r.approvedCount;
      dismissedThisMonth += r.dismissedCount;
      rejectedThisMonth += r.rejectedCount;
    }
  }

  return {
    approvedThisMonth,
    dismissedThisMonth,
    rejectedThisMonth,
    autoSendCount,
    alwaysReviewCount,
    hasAnyRow: rows.length > 0,
  };
}

// Used by tests + the SQL gte() helper.
export { CONFIDENCE_SAMPLE_FLOOR, PROMOTE_CONSECUTIVE_APPROVALS, DEMOTE_CONSECUTIVE_DISMISSALS, DEMOTE_REJECTED_COUNT, REJECT_WINDOW_DAYS, EDIT_POSITIVE_WEIGHT };

// Re-export drizzle helpers callers might need.
export { gte };
