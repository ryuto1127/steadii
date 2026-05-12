import { describe, expect, it } from "vitest";
import { timeConflictRule } from "@/lib/agent/proactive/rules/time-conflict";
import { examConflictRule } from "@/lib/agent/proactive/rules/exam-conflict";
import { deadlineDuringTravelRule } from "@/lib/agent/proactive/rules/deadline-during-travel";
import { workloadOverCapacityRule } from "@/lib/agent/proactive/rules/workload-over-capacity";
import { classroomDeadlineImminentRule } from "@/lib/agent/proactive/rules/classroom-deadline-imminent";
import { calendarDoubleBookingRule } from "@/lib/agent/proactive/rules/calendar-double-booking";
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
        status: null,
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
        status: null,
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
        status: null,
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
        status: null,
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
        status: null,
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

  it("does not fire when the calendar event title references the class code (Steadii-imported exam)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "[Steadii] MAT223 Final Exam",
        description: null,
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
    ];
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MAT223",
        className: "Linear Algebra II",
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        label: "Final Exam",
      },
    ];
    expect(examConflictRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire when the calendar event title references the class name (user-managed duplicate of the exam)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Linear Algebra II Final",
        description: null,
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
    ];
    snapshot.examWindows = [
      {
        classId: "c1",
        classCode: "MAT223",
        className: "Linear Algebra II",
        startsAt: new Date("2026-05-16T14:00:00Z"),
        endsAt: new Date("2026-05-16T15:30:00Z"),
        label: "Final Exam",
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
        status: null,
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
        status: null,
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

  // engineer-43 — workload now counts Google Tasks + MS To Do too.
  it("fires when Google Tasks alone push the 7-day window past the budget", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = Array.from({ length: 12 }).map((_, i) => ({
      id: `tsk-${i}`,
      sourceType: "google_tasks",
      externalId: `g-tsk-${i}`,
      title: `Reading ${i}`,
      description: null,
      startsAt: new Date(
        `2026-05-${String(4 + Math.floor(i / 2)).padStart(2, "0")}T23:59:59Z`
      ),
      endsAt: null,
      isAllDay: false,
      location: null,
      status: null,
    }));
    const issues = workloadOverCapacityRule.detect(snapshot);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].issueType).toBe("workload_over_capacity");
  });

  it("excludes Classroom coursework from the workload count (handled by classroom rule)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = Array.from({ length: 12 }).map((_, i) => ({
      id: `cw-${i}`,
      sourceType: "google_classroom_coursework",
      externalId: `g-cw-${i}`,
      title: `Problem set ${i}`,
      description: null,
      startsAt: new Date(
        `2026-05-${String(4 + Math.floor(i / 2)).padStart(2, "0")}T23:59:59Z`
      ),
      endsAt: null,
      isAllDay: false,
      location: null,
      status: null,
    }));
    expect(workloadOverCapacityRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("classroom_deadline_imminent rule", () => {
  it("fires for Classroom coursework due in <24h with no turn-in", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "cw-1",
        sourceType: "google_classroom_coursework",
        externalId: "g-cw-1",
        title: "Lab report 4",
        description: null,
        startsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
        endsAt: null,
        isAllDay: false,
        location: null,
        status: "needs_action",
      },
    ];
    const issues = classroomDeadlineImminentRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("classroom_deadline_imminent");
  });

  it("does not fire for coursework already turned in (status=completed)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "cw-1",
        sourceType: "google_classroom_coursework",
        externalId: "g-cw-1",
        title: "Lab report 4",
        description: null,
        startsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
        endsAt: null,
        isAllDay: false,
        location: null,
        status: "completed",
      },
    ];
    expect(classroomDeadlineImminentRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire for coursework more than 24h away", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "cw-1",
        sourceType: "google_classroom_coursework",
        externalId: "g-cw-1",
        title: "Lab report 4",
        description: null,
        startsAt: new Date(NOW.getTime() + 72 * 60 * 60 * 1000),
        endsAt: null,
        isAllDay: false,
        location: null,
        status: "needs_action",
      },
    ];
    expect(classroomDeadlineImminentRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire for non-Classroom events even if they're imminent", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-1",
        sourceType: "google_calendar",
        externalId: "g1",
        title: "Coffee chat",
        description: null,
        startsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
        endsAt: null,
        isAllDay: false,
        location: null,
        status: "confirmed",
      },
    ];
    expect(classroomDeadlineImminentRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("calendar_double_booking rule", () => {
  it("fires when two timed events overlap", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-a",
        sourceType: "google_calendar",
        externalId: "ga",
        title: "Meeting A",
        description: null,
        startsAt: new Date("2026-05-04T14:00:00Z"),
        endsAt: new Date("2026-05-04T15:00:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
      {
        id: "evt-b",
        sourceType: "microsoft_graph",
        externalId: "mb",
        title: "Meeting B",
        description: null,
        startsAt: new Date("2026-05-04T14:30:00Z"),
        endsAt: new Date("2026-05-04T15:30:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
    ];
    const issues = calendarDoubleBookingRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("calendar_double_booking");
    expect(issues[0].sourceRefs.length).toBe(2);
  });

  it("does not fire on back-to-back events (end == next start)", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-a",
        sourceType: "google_calendar",
        externalId: "ga",
        title: "Meeting A",
        description: null,
        startsAt: new Date("2026-05-04T14:00:00Z"),
        endsAt: new Date("2026-05-04T15:00:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
      {
        id: "evt-b",
        sourceType: "google_calendar",
        externalId: "gb",
        title: "Meeting B",
        description: null,
        startsAt: new Date("2026-05-04T15:00:00Z"),
        endsAt: new Date("2026-05-04T16:00:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
    ];
    expect(calendarDoubleBookingRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire on all-day events", () => {
    const snapshot = emptySnapshot();
    snapshot.calendarEvents = [
      {
        id: "evt-a",
        sourceType: "google_calendar",
        externalId: "ga",
        title: "Trip",
        description: null,
        startsAt: new Date("2026-05-04T00:00:00Z"),
        endsAt: new Date("2026-05-06T00:00:00Z"),
        isAllDay: true,
        location: null,
        status: null,
      },
      {
        id: "evt-b",
        sourceType: "google_calendar",
        externalId: "gb",
        title: "Meeting B",
        description: null,
        startsAt: new Date("2026-05-04T14:00:00Z"),
        endsAt: new Date("2026-05-04T15:00:00Z"),
        isAllDay: false,
        location: null,
        status: null,
      },
    ];
    expect(calendarDoubleBookingRule.detect(snapshot)).toHaveLength(0);
  });
});
