import { describe, expect, it } from "vitest";
import { assignmentDeadlineReminderRule } from "@/lib/agent/proactive/rules/assignment-deadline-reminder";
import type { UserSnapshot } from "@/lib/agent/proactive/types";

const NOW = new Date("2026-05-01T12:00:00Z");
const HOUR = 3600 * 1000;

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

function makeAssignment(overrides: Partial<UserSnapshot["assignments"][number]>): UserSnapshot["assignments"][number] {
  return {
    id: "a1",
    classId: null,
    title: "Lab Report",
    dueAt: null,
    status: "not_started",
    ...overrides,
  };
}

describe("assignment_deadline_reminder rule", () => {
  it("fires due_in_7d when not_started and 7 days out", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-7d",
        title: "Essay 3",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 7 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("assignment_deadline_reminder");
    expect(issues[0].issueSummary).toContain("1週間後");
    expect(issues[0].sourceRefs[0]).toEqual({
      kind: "assignment",
      id: "a-7d",
      label: "Essay 3",
    });
    expect(issues[0].sourceRecordIds).toEqual(["a-7d", "due_in_7d"]);
  });

  it("does NOT fire due_in_7d when in_progress (gated to not_started)", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-7d-ip",
        status: "in_progress",
        dueAt: new Date(NOW.getTime() + 7 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("fires due_in_3d (not_started variant) when not_started and ~3 days out", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-3d-ns",
        title: "Problem Set",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueSummary).toContain("3日後締切、まだ未着手");
    expect(issues[0].sourceRecordIds).toEqual(["a-3d-ns", "due_in_3d"]);
  });

  it("fires due_in_3d (in_progress variant) when in_progress and ~3 days out", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-3d-ip",
        title: "Problem Set",
        status: "in_progress",
        dueAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueSummary).toContain("3日後締切（着手中）");
  });

  it("fires due_in_1d when any non-done status and ~1.5 days out", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-1d",
        title: "Quiz",
        status: "in_progress",
        dueAt: new Date(NOW.getTime() + 36 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueSummary).toContain("明日締切");
    expect(issues[0].sourceRecordIds).toEqual(["a-1d", "due_in_1d"]);
  });

  it("fires due_today when ~0h left and not_started", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-0",
        title: "Final draft",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 2 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueSummary).toContain("今日締切");
    expect(issues[0].sourceRecordIds).toEqual(["a-0", "due_today"]);
  });

  it("is silent in the 3-5 day gap window (intentional)", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-5d",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 5 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("is silent when status='done' regardless of due", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-done-0",
        status: "done",
        dueAt: new Date(NOW.getTime() + 1 * HOUR),
      }),
      makeAssignment({
        id: "a-done-7d",
        status: "done",
        dueAt: new Date(NOW.getTime() + 7 * 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("is silent for past-due assignments (negative delta)", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-overdue",
        status: "not_started",
        dueAt: new Date(NOW.getTime() - 2 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("is silent for assignments with null dueAt", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-no-due",
        status: "not_started",
        dueAt: null,
      }),
    ];
    expect(assignmentDeadlineReminderRule.detect(snapshot)).toHaveLength(0);
  });

  it("emits independent issues for multiple assignments at different tiers", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-multi-7d",
        title: "Essay",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 7 * 24 * HOUR),
      }),
      makeAssignment({
        id: "a-multi-1d",
        title: "Quiz",
        status: "in_progress",
        dueAt: new Date(NOW.getTime() + 36 * HOUR),
      }),
      makeAssignment({
        id: "a-multi-0",
        title: "Lab",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 3 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(3);
    const tiers = issues.map((i) => i.sourceRecordIds[1]).sort();
    expect(tiers).toEqual(["due_in_1d", "due_in_7d", "due_today"]);
    // No cross-talk — each issue's sourceRefs has a unique assignment id
    const ids = issues.map((i) => i.sourceRefs[0].id).sort();
    expect(ids).toEqual(["a-multi-0", "a-multi-1d", "a-multi-7d"]);
  });

  it("emits at most one tier per assignment per scan (boundary at 24h)", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      makeAssignment({
        id: "a-boundary",
        status: "not_started",
        dueAt: new Date(NOW.getTime() + 24 * HOUR),
      }),
    ];
    const issues = assignmentDeadlineReminderRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    // Exactly 24h → due_today (the first-match-wins ladder)
    expect(issues[0].sourceRecordIds).toEqual(["a-boundary", "due_today"]);
  });
});
