import { describe, expect, it } from "vitest";
import { timeConflictRule } from "@/lib/agent/proactive/rules/time-conflict";
import { examConflictRule } from "@/lib/agent/proactive/rules/exam-conflict";
import { deadlineDuringTravelRule } from "@/lib/agent/proactive/rules/deadline-during-travel";
import { examUnderPreparedRule } from "@/lib/agent/proactive/rules/exam-under-prepared";
import { workloadOverCapacityRule } from "@/lib/agent/proactive/rules/workload-over-capacity";
import type { UserSnapshot } from "@/lib/agent/proactive/types";

const NOW = new Date("2026-05-01T00:00:00Z");

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
  };
}

describe("time_conflict rule", () => {
  it("fires when a calendar event overlaps a class lecture block", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Coffee with mentor",
        description: null,
        startsAt: new Date("2026-05-04T15:00:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        isAllDay: false,
        location: null,
      },
    ];
    snapshot.classTimeBlocks = [
      {
        classId: "c1",
        classCode: "CSC110",
        className: "Computer Science I",
        startsAt: new Date("2026-05-04T14:30:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        topic: "Recursion",
      },
    ];
    const issues = timeConflictRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("time_conflict");
    expect(issues[0].sourceRefs.some((r) => r.kind === "calendar_event")).toBe(
      true
    );
  });

  it("does not fire when the calendar event is the class itself (title matches code)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "CSC110 Lecture",
        description: null,
        startsAt: new Date("2026-05-04T14:30:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        isAllDay: false,
        location: null,
      },
    ];
    snapshot.classTimeBlocks = [
      {
        classId: "c1",
        classCode: "CSC110",
        className: "Computer Science I",
        startsAt: new Date("2026-05-04T14:30:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        topic: "Recursion",
      },
    ];
    const issues = timeConflictRule.detect(snapshot);
    expect(issues).toHaveLength(0);
  });

  it("does not fire on all-day calendar events", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Trip",
        description: null,
        startsAt: new Date("2026-05-04T00:00:00Z"),
        endsAt: new Date("2026-05-04T23:59:59Z"),
        isAllDay: true,
        location: null,
      },
    ];
    snapshot.classTimeBlocks = [
      {
        classId: "c1",
        classCode: "CSC110",
        className: "Computer Science I",
        startsAt: new Date("2026-05-04T14:30:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        topic: "Recursion",
      },
    ];
    expect(timeConflictRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("exam_conflict rule", () => {
  it("fires when a calendar event overlaps an exam window", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Family trip",
        description: null,
        startsAt: new Date("2026-05-16T13:00:00Z"),
        endsAt: new Date("2026-05-16T17:00:00Z"),
        isAllDay: false,
        location: null,
      },
    ];
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MATH200",
        className: "Math II",
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        label: "中間試験",
      },
    ];
    const issues = examConflictRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("exam_conflict");
    expect(issues[0].issueSummary).toContain("MATH200");
  });

  it("does not fire when calendar event ends before the exam starts", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Coffee",
        description: null,
        startsAt: new Date("2026-05-16T10:00:00Z"),
        endsAt: new Date("2026-05-16T11:00:00Z"),
        isAllDay: false,
        location: null,
      },
    ];
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MATH200",
        className: "Math II",
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        label: "中間試験",
      },
    ];
    expect(examConflictRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("deadline_during_travel rule", () => {
  it("fires when an assignment due date falls inside a multi-day calendar block", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "trip-1",
        sourceType: "google_calendar",
        externalId: "t1",
        title: "Tokyo trip",
        description: null,
        startsAt: new Date("2026-05-10T00:00:00Z"),
        endsAt: new Date("2026-05-15T23:59:59Z"),
        isAllDay: true,
        location: null,
      },
    ];
    snapshot.assignments = [
      {
        id: "a1",
        classId: "c1",
        title: "Problem set 5",
        dueAt: new Date("2026-05-12T23:59:59Z"),
        status: "not_started",
      },
    ];
    const issues = deadlineDuringTravelRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("deadline_during_travel");
  });

  it("does not fire on a single-hour calendar event", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "trip-1",
        sourceType: "google_calendar",
        externalId: "t1",
        title: "Coffee",
        description: null,
        startsAt: new Date("2026-05-12T12:00:00Z"),
        endsAt: new Date("2026-05-12T13:00:00Z"),
        isAllDay: false,
        location: null,
      },
    ];
    snapshot.assignments = [
      {
        id: "a1",
        classId: "c1",
        title: "Problem set 5",
        dueAt: new Date("2026-05-12T23:59:59Z"),
        status: "not_started",
      },
    ];
    expect(deadlineDuringTravelRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("exam_under_prepared rule", () => {
  it("fires when an exam is within 7 days and no recent class activity", () => {
    const snapshot = emptySnapshot();
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MATH200",
        className: "Math II",
        startsAt: new Date("2026-05-05T14:00:00Z"),
        endsAt: new Date("2026-05-05T15:30:00Z"),
        label: "中間試験",
      },
    ];
    snapshot.recentClassActivityDays = { c1: null };
    const issues = examUnderPreparedRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("exam_under_prepared");
  });

  it("does not fire when there's recent activity (≤14 days)", () => {
    const snapshot = emptySnapshot();
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MATH200",
        className: "Math II",
        startsAt: new Date("2026-05-05T14:00:00Z"),
        endsAt: new Date("2026-05-05T15:30:00Z"),
        label: "中間試験",
      },
    ];
    snapshot.recentClassActivityDays = { c1: 3 };
    expect(examUnderPreparedRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire when the exam is more than 7 days out", () => {
    const snapshot = emptySnapshot();
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MATH200",
        className: "Math II",
        startsAt: new Date("2026-05-15T14:00:00Z"),
        endsAt: new Date("2026-05-15T15:30:00Z"),
        label: "中間試験",
      },
    ];
    snapshot.recentClassActivityDays = { c1: null };
    expect(examUnderPreparedRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("workload_over_capacity rule", () => {
  it("fires when a 7-day window exceeds 30h estimated workload", () => {
    const snapshot = emptySnapshot();
    // 12 assignments × 3h default = 36h, all clustered in a 6-day window.
    snapshot.assignments = Array.from({ length: 12 }).map((_, i) => ({
      id: `a${i}`,
      classId: "c1",
      title: `Problem set ${i}`,
      dueAt: new Date(
        `2026-05-${String(4 + Math.floor(i / 2)).padStart(2, "0")}T23:59:59Z`
      ),
      status: "not_started",
    }));
    const issues = workloadOverCapacityRule.detect(snapshot);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].issueType).toBe("workload_over_capacity");
  });

  it("does not fire when the 7-day window is light", () => {
    const snapshot = emptySnapshot();
    snapshot.assignments = [
      {
        id: "a1",
        classId: "c1",
        title: "One small thing",
        dueAt: new Date("2026-05-04T23:59:59Z"),
        status: "not_started",
      },
    ];
    expect(workloadOverCapacityRule.detect(snapshot)).toHaveLength(0);
  });
});
