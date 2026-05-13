import { describe, expect, it, vi } from "vitest";

// The sender-confidence module is server-only and imports the live db
// client. We don't exercise the DB write paths here; we want
// deterministic coverage of the formula + the promotion decision tree.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  computeConfidence,
  decidePromotion,
  CONFIDENCE_SAMPLE_FLOOR,
  PROMOTE_CONSECUTIVE_APPROVALS,
  DEMOTE_CONSECUTIVE_DISMISSALS,
  DEMOTE_REJECTED_COUNT,
  EDIT_POSITIVE_WEIGHT,
} from "@/lib/agent/learning/sender-confidence";

describe("computeConfidence", () => {
  it("returns 0.5 baseline when no samples", () => {
    expect(computeConfidence(0, 0, 0, 0)).toBe(0.5);
  });

  it("stays at or below 0.85 with only 4 approvals (under sample floor)", () => {
    // 4 approved / max(4, 5) = 0.8 — under the 0.85 promote threshold
    const c = computeConfidence(4, 0, 0, 0);
    expect(c).toBeCloseTo(4 / CONFIDENCE_SAMPLE_FLOOR, 5);
    expect(c).toBeLessThanOrEqual(0.85);
  });

  it("crosses 0.85 once 5 clean approvals are recorded", () => {
    const c = computeConfidence(5, 0, 0, 0);
    expect(c).toBeGreaterThanOrEqual(0.85);
    // 5 / max(5, 5) = 1.0
    expect(c).toBe(1.0);
  });

  it("counts edited as a soft-positive at 0.3 weight", () => {
    // 5 edited-but-sent ≈ 1.5 effective positives, total = 1.5,
    // sample floor still kicks in → 1.5 / 5 = 0.3
    const c = computeConfidence(0, 5, 0, 0);
    expect(c).toBeCloseTo((5 * EDIT_POSITIVE_WEIGHT) / 5, 5);
  });

  it("treats a single reject like a single dismissal weight-wise", () => {
    // 5 approved + 1 reject vs 5 approved + 1 dismissed should be
    // equivalent in the confidence formula
    const withReject = computeConfidence(5, 0, 0, 1);
    const withDismiss = computeConfidence(5, 0, 1, 0);
    expect(withReject).toBeCloseTo(withDismiss, 5);
  });

  it("clamps confidence to [0, 1]", () => {
    expect(computeConfidence(0, 0, 0, 100)).toBeGreaterThanOrEqual(0);
    expect(computeConfidence(50, 0, 0, 0)).toBeLessThanOrEqual(1);
  });
});

describe("decidePromotion", () => {
  const base = {
    approvedCount: 0,
    editedCount: 0,
    dismissedCount: 0,
    rejectedCount: 0,
    rejectedCountInWindow: 0,
    consecutiveApprovedCount: 0,
    consecutiveDismissedCount: 0,
    learnedConfidence: 0.5,
    actionType: "draft_reply" as const,
    autoSendOk: true,
    currentState: "baseline" as const,
  };

  it("auto-promotes to auto_send after 5 consecutive approvals with high confidence", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 5,
      consecutiveApprovedCount: PROMOTE_CONSECUTIVE_APPROVALS,
      learnedConfidence: 0.95,
    });
    expect(result.state).toBe("auto_send");
    expect(result.reason).toContain("streak");
  });

  it("does NOT promote when autoSendOk is false (user opted out globally)", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 5,
      consecutiveApprovedCount: PROMOTE_CONSECUTIVE_APPROVALS,
      learnedConfidence: 0.95,
      autoSendOk: false,
    });
    expect(result.state).toBe("baseline");
  });

  it("does NOT promote notify_only actions even with 5 approvals", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 5,
      consecutiveApprovedCount: PROMOTE_CONSECUTIVE_APPROVALS,
      learnedConfidence: 0.95,
      actionType: "notify_only",
    });
    expect(result.state).toBe("baseline");
  });

  it("auto-demotes to always_review after 3 consecutive dismissals", () => {
    const result = decidePromotion({
      ...base,
      dismissedCount: DEMOTE_CONSECUTIVE_DISMISSALS,
      consecutiveDismissedCount: DEMOTE_CONSECUTIVE_DISMISSALS,
      learnedConfidence: 0.3,
    });
    expect(result.state).toBe("always_review");
    expect(result.reason).toContain("consecutive_dismissed");
  });

  it("does NOT demote on a single reject", () => {
    const result = decidePromotion({
      ...base,
      rejectedCount: 1,
      rejectedCountInWindow: 1,
    });
    // Single reject inside the window does not meet DEMOTE_REJECTED_COUNT (2)
    expect(result.state).toBe("baseline");
  });

  it("auto-demotes to always_review on 2 rejects within 30 days", () => {
    const result = decidePromotion({
      ...base,
      rejectedCount: DEMOTE_REJECTED_COUNT,
      rejectedCountInWindow: DEMOTE_REJECTED_COUNT,
    });
    expect(result.state).toBe("always_review");
    expect(result.reason).toContain("rejected_in_30d");
  });

  it("demote beats promote — even mid-approval-streak a reject downgrade fires", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 10,
      consecutiveApprovedCount: 10,
      learnedConfidence: 0.95,
      rejectedCount: DEMOTE_REJECTED_COUNT,
      rejectedCountInWindow: DEMOTE_REJECTED_COUNT,
    });
    expect(result.state).toBe("always_review");
  });

  it("blocks promote when a reject is within the 30-day window even with 5 approvals", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 5,
      consecutiveApprovedCount: PROMOTE_CONSECUTIVE_APPROVALS,
      learnedConfidence: 0.95,
      rejectedCount: 1,
      rejectedCountInWindow: 1,
    });
    // 1 reject doesn't trigger demote (need 2), but the promote rule
    // says rejectedCountInWindow must be 0. So state stays baseline.
    expect(result.state).toBe("baseline");
  });

  it("preserves the current state when neither promote nor demote fires", () => {
    const result = decidePromotion({
      ...base,
      approvedCount: 2,
      learnedConfidence: 0.6,
      currentState: "auto_send",
    });
    // No rule fires; we keep auto_send (user has to explicitly revoke).
    expect(result.state).toBe("auto_send");
  });
});
