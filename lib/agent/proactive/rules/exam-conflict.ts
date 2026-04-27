// Rule 2 — Exam conflict.
// A calendar event overlaps a syllabus-listed exam window. Distinct
// from time_conflict in two ways:
// 1. It dominates the alert priority — exams beat lectures.
// 2. Recommended actions differ (skip is not an option for an exam).

import type { ProactiveRule, DetectedIssue } from "../types";

export const examConflictRule: ProactiveRule = {
  name: "exam_conflict",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    for (const evt of snapshot.calendarEvents) {
      const evtEnd = evt.endsAt ?? evt.startsAt;

      for (const exam of snapshot.examWindows) {
        // For all-day events, treat them as covering the calendar
        // day — exam during a multi-day "trip" still flags.
        const evtStart = evt.startsAt;
        const evtFinish = evt.isAllDay
          ? new Date(evtStart.getTime() + 24 * 3600 * 1000)
          : evtEnd;
        const overlaps = evtStart < exam.endsAt && evtFinish > exam.startsAt;
        if (!overlaps) continue;

        const examLabel = `${exam.classCode ?? exam.className ?? "Exam"} ${
          exam.label
        }`;
        issues.push({
          issueType: "exam_conflict",
          sourceRecordIds: [
            evt.id,
            `exam:${exam.classId ?? "unknown"}:${exam.startsAt
              .toISOString()
              .slice(0, 10)}`,
          ],
          issueSummary: `${examLabel} と「${evt.title}」が重複`,
          reasoning: `Syllabus lists ${examLabel} on ${formatDate(
            exam.startsAt
          )}. Calendar has "${evt.title}" overlapping that window. Exams are not reschedulable like lectures — confirming the conflict before either commitment ships is high-value.`,
          sourceRefs: [
            {
              kind: "calendar_event",
              id: evt.id,
              label: evt.title,
            },
            {
              kind: "syllabus_event",
              id: `${exam.classId ?? "unknown"}:${exam.startsAt
                .toISOString()
                .slice(0, 10)}`,
              label: examLabel,
            },
          ],
        });
      }
    }
    return issues;
  },
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}
