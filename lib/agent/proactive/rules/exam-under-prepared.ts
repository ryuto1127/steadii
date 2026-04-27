// Rule 4 — Exam under-prepared.
// A syllabus-listed exam is <7 days away AND no chat/mistake/study
// signal has fired for that class in the prior 14 days.
//
// "Signal absent" = recentClassActivityDays[classId] is null OR > 14.
// The snapshot pre-computes activity days from mistake_notes; chat
// activity is a TODO once the data model attributes chat by class.

import type { ProactiveRule, DetectedIssue } from "../types";

const EXAM_HORIZON_DAYS = 7;

export const examUnderPreparedRule: ProactiveRule = {
  name: "exam_under_prepared",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    const now = snapshot.now;
    const horizon = new Date(
      now.getTime() + EXAM_HORIZON_DAYS * 24 * 3600 * 1000
    );

    for (const exam of snapshot.examWindows) {
      if (!exam.classId) continue;
      if (exam.startsAt < now || exam.startsAt > horizon) continue;

      const recentDays = snapshot.recentClassActivityDays[exam.classId];
      // recentDays === null  → no mistake activity in the last 14d
      // recentDays > 14      → too long ago to count as prep signal
      if (recentDays !== null && recentDays <= 14) continue;

      const daysToExam = Math.max(
        1,
        Math.ceil(
          (exam.startsAt.getTime() - now.getTime()) / (24 * 3600 * 1000)
        )
      );
      const examLabel = `${exam.classCode ?? exam.className ?? "Exam"} ${
        exam.label
      }`;

      issues.push({
        issueType: "exam_under_prepared",
        sourceRecordIds: [
          `exam:${exam.classId}:${exam.startsAt.toISOString().slice(0, 10)}`,
        ],
        issueSummary: `${examLabel} まで ${daysToExam} 日 — 復習記録が空`,
        reasoning: `${examLabel} is in ${daysToExam} days (${formatDate(
          exam.startsAt
        )}). Steadii has no mistake-note activity for ${
          exam.className ?? "this class"
        } in the last 14 days. Either start a review block now, or confirm prep is happening elsewhere — silence at this point usually means the exam is the surprise.`,
        sourceRefs: [
          {
            kind: "syllabus_event",
            id: `${exam.classId}:${exam.startsAt.toISOString().slice(0, 10)}`,
            label: examLabel,
          },
          {
            kind: "class",
            id: exam.classId,
            label: exam.className ?? "(class)",
          },
        ],
      });
    }
    return issues;
  },
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}
