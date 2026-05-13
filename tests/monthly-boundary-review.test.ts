import { describe, expect, it } from "vitest";
import { monthlyBoundaryReviewRule } from "@/lib/agent/proactive/rules/monthly-boundary-review";
import type { UserSnapshot } from "@/lib/agent/proactive/types";

const NOW = new Date("2026-05-12T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function emptySnapshot(): UserSnapshot {
  return {
    userId: "u1",
    now: NOW,
    timezone: "America/Vancouver",
    classes: [],
    calendarEvents: [],
    assignments: [],
    syllabi: [],
    classTimeBlocks: [],
    examWindows: [],
    recentClassActivityDays: {},
    monthlyReview: null,
    entitySignals: [],
  };
}

describe("monthly_boundary_review rule", () => {
  it("does not fire when monthlyReview is null", () => {
    const issues = monthlyBoundaryReviewRule.detect(emptySnapshot());
    expect(issues).toHaveLength(0);
  });

  it("fires when there is activity and no prior review timestamp", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: null,
      approvedThisMonth: 8,
      dismissedThisMonth: 3,
      rejectedThisMonth: 1,
      autoSendCount: 1,
      alwaysReviewCount: 2,
    };
    const issues = monthlyBoundaryReviewRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("monthly_boundary_review");
    expect(issues[0].issueSummary).toContain("8");
    expect(issues[0].issueSummary).toContain("3");
    expect(issues[0].issueSummary).toContain("1");
    // Action menu surfaces the deep link to the tuning page.
    const review = issues[0].baselineActions?.find((a) => a.key === "review");
    expect(review).toBeDefined();
    expect(review?.payload).toMatchObject({
      href: "/app/settings/agent-tuning",
    });
  });

  it("suppresses when lastReviewAt is within the past 30 days", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: new Date(NOW.getTime() - 15 * DAY_MS),
      approvedThisMonth: 5,
      dismissedThisMonth: 2,
      rejectedThisMonth: 0,
      autoSendCount: 0,
      alwaysReviewCount: 0,
    };
    const issues = monthlyBoundaryReviewRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("re-fires when lastReviewAt is older than 30 days", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: new Date(NOW.getTime() - 35 * DAY_MS),
      approvedThisMonth: 5,
      dismissedThisMonth: 2,
      rejectedThisMonth: 0,
      autoSendCount: 0,
      alwaysReviewCount: 0,
    };
    const issues = monthlyBoundaryReviewRule.detect(snapshot);
    expect(issues).toHaveLength(1);
  });

  it("suppresses on a completely quiet month (no activity, no promotions)", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: null,
      approvedThisMonth: 0,
      dismissedThisMonth: 0,
      rejectedThisMonth: 0,
      autoSendCount: 0,
      alwaysReviewCount: 0,
    };
    const issues = monthlyBoundaryReviewRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("fires on activity-quiet month if promotion state exists (e.g. always_review held)", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: null,
      approvedThisMonth: 0,
      dismissedThisMonth: 0,
      rejectedThisMonth: 0,
      autoSendCount: 0,
      alwaysReviewCount: 2,
    };
    const issues = monthlyBoundaryReviewRule.detect(snapshot);
    expect(issues).toHaveLength(1);
  });

  it("buckets dedup by 30-day windows so re-firing after the window does not collide", () => {
    const snapshot = emptySnapshot();
    snapshot.monthlyReview = {
      lastReviewAt: null,
      approvedThisMonth: 3,
      dismissedThisMonth: 1,
      rejectedThisMonth: 0,
      autoSendCount: 0,
      alwaysReviewCount: 0,
    };
    const firstNow = snapshot.now;
    const firstIssue = monthlyBoundaryReviewRule.detect(snapshot)[0];

    // Same scan a minute later → same bucket → same dedup key
    snapshot.now = new Date(firstNow.getTime() + 60 * 1000);
    const secondIssue = monthlyBoundaryReviewRule.detect(snapshot)[0];
    expect(secondIssue.sourceRecordIds).toEqual(firstIssue.sourceRecordIds);

    // Scan 60 days later → different bucket → different dedup key
    snapshot.now = new Date(firstNow.getTime() + 60 * DAY_MS);
    const thirdIssue = monthlyBoundaryReviewRule.detect(snapshot)[0];
    expect(thirdIssue.sourceRecordIds).not.toEqual(firstIssue.sourceRecordIds);
  });
});
