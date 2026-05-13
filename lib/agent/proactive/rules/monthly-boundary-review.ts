// engineer-49 — Monthly check-in card surfacing learned per-sender
// promotion/demotion state.
//
// Fires at most once per ~30 days per user. The card body shows how
// many drafts the user approved / dismissed / rejected in the trailing
// 30 days and how many senders have crossed into auto_send /
// always_review. Clicking the card opens /app/settings/agent-tuning
// where the user can revoke specific promotions or forgive a
// previously-rejected sender.
//
// Cadence is tracked via `users.preferences.lastMonthlyReviewAt`,
// stamped when the user *views* the proposal (not when it's emitted) —
// keeping the model honest about whether the check-in was seen.
//
// Quiet days: a user with no sender_confidence rows yet doesn't get
// this card. monthlyReview will be null on the snapshot in that case
// and the rule short-circuits.

import type { ProactiveRule } from "../types";

// 30-day minimum cadence between successive cards. Matches the handoff
// language ("monthly-cadence boundary re-adjustment surface").
const MIN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export const monthlyBoundaryReviewRule: ProactiveRule = {
  name: "monthly_boundary_review",
  detect(snapshot) {
    const m = snapshot.monthlyReview;
    if (!m) return [];

    // Cadence gate. If we surfaced a card within the past 30 days,
    // suppress — the user shouldn't see this more than once a month.
    if (m.lastReviewAt) {
      const elapsed = snapshot.now.getTime() - m.lastReviewAt.getTime();
      if (elapsed < MIN_INTERVAL_MS) return [];
    }

    // Suppress when nothing meaningful happened. We need at least some
    // activity to summarize — a user who hasn't approved / dismissed /
    // rejected anything in the past 30 days doesn't need a check-in
    // (their boundaries haven't moved).
    const activity =
      m.approvedThisMonth + m.dismissedThisMonth + m.rejectedThisMonth;
    if (activity === 0 && m.autoSendCount === 0 && m.alwaysReviewCount === 0) {
      return [];
    }

    // Build the summary line in JA (matches the locked digest copy
    // language; the in-app card surface also renders the EN side via
    // i18n on the detail page).
    const summary = `今月: 承認${m.approvedThisMonth} / dismiss${m.dismissedThisMonth} / reject${m.rejectedThisMonth}。自動送信 ${m.autoSendCount} 件、要レビュー ${m.alwaysReviewCount} 件。`;
    const reasoning = `Monthly boundary check-in. Past 30 days: ${m.approvedThisMonth} approvals, ${m.dismissedThisMonth} dismissals, ${m.rejectedThisMonth} rejects. ${m.autoSendCount} senders auto-promoted; ${m.alwaysReviewCount} demoted to always-review. Review and adjust at /app/settings/agent-tuning.`;

    // Dedup on a per-month bucket so the card can re-fire after the
    // 30-day window without colliding with the previously dismissed /
    // resolved row. Bucket = floor(now / 30d).
    const monthBucket = Math.floor(
      snapshot.now.getTime() / MIN_INTERVAL_MS
    ).toString();

    return [
      {
        issueType: "monthly_boundary_review",
        sourceRecordIds: [monthBucket],
        issueSummary: summary,
        reasoning,
        sourceRefs: [],
        baselineActions: [
          {
            key: "review",
            label: "Open agent tuning",
            description: "View learned senders + adjust thresholds.",
            tool: "auto",
            payload: { href: "/app/settings/agent-tuning" },
          },
          {
            key: "dismiss",
            label: "Looks good",
            description: "Acknowledge and keep current settings.",
            tool: "dismiss",
            payload: {},
          },
        ],
      },
    ];
  },
};
