import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    NOTION_CLIENT_ID: "test",
    NOTION_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import {
  decidePromotion,
  DEMOTE_CONSECUTIVE_DISMISSALS,
} from "@/lib/agent/learning/sender-confidence";

// PART 2 — the 確認済み (neutral, "I already handled / saw this") action
// must NOT demote a sender, while 却下 / dismiss must. The dismiss path
// (dismissAgentDraftAction / permanentDismiss) feeds the learner a
// 'dismissed' SenderEventKind; the neutral mark-handled path
// (queueSetDispositionAction('resolved') / queueMarkHandledAction)
// records NO learner event at all — it only flips the disposition
// column. We model that asymmetry on the pure decision function:
//
//   - N consecutive dismissals reaching the threshold → demote to
//     always_review (the negative signal).
//   - the neutral path adds nothing, so the counters that would drive a
//     demote never increment — promotion stays at its prior state.
//
// We assert against decidePromotion (pure, exported) rather than
// DB-mocking recordSenderEvent, per the handoff's "prefer pure helpers".

function baseArgs() {
  return {
    approvedCount: 4,
    editedCount: 0,
    rejectedCount: 0,
    rejectedCountInWindow: 0,
    consecutiveApprovedCount: 0,
    learnedConfidence: 0.6,
    actionType: "draft_reply" as const,
    autoSendOk: false,
    currentState: "baseline" as const,
  };
}

describe("確認済み (neutral) vs 却下 (dismiss) learning distinction", () => {
  it("却下 / dismiss: consecutive dismissals at the threshold demote the sender", () => {
    const decision = decidePromotion({
      ...baseArgs(),
      // The dismiss path increments dismissedCount + the consecutive
      // dismissed streak. At the threshold the sender × action demotes.
      dismissedCount: DEMOTE_CONSECUTIVE_DISMISSALS,
      consecutiveDismissedCount: DEMOTE_CONSECUTIVE_DISMISSALS,
    });
    expect(decision.state).toBe("always_review");
    expect(decision.reason).toContain("consecutive_dismissed");
  });

  it("確認済み / resolved: records no learner event, so counters never reach demote → state unchanged", () => {
    // The neutral path writes ONLY disposition='resolved'. It never calls
    // recordSenderEvent, so dismissedCount / consecutiveDismissedCount
    // stay at 0 no matter how many times the user marks things handled.
    const decision = decidePromotion({
      ...baseArgs(),
      dismissedCount: 0,
      consecutiveDismissedCount: 0,
    });
    expect(decision.state).toBe("baseline");
    expect(decision.reason).toBeNull();
  });

  it("a single dismiss below the threshold does NOT yet demote (so neutral handling and one stray dismiss diverge only at the threshold)", () => {
    const decision = decidePromotion({
      ...baseArgs(),
      dismissedCount: 1,
      consecutiveDismissedCount: DEMOTE_CONSECUTIVE_DISMISSALS - 1,
    });
    expect(decision.state).toBe("baseline");
  });
});
