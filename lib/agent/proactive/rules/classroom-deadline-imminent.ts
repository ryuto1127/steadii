// engineer-43 — Classroom deadline imminent.
// A Google Classroom coursework item is due in <24h AND Steadii sees no
// recent activity from the student on it (status not completed). Replaces
// the dead `exam_under_prepared` rule (which lost its data source when
// PR #182 dropped mistakes) and is broader because it fires for any
// Classroom user, not just syllabus-bound ones.
//
// "Activity" signal: we only have one cheap structural marker — the
// event's status. A graded / turned-in coursework flips to
// status='completed' via the Classroom sync, so anything still
// 'needs_action' (or null) with <24h to go is the alert candidate.
// Future iterations can layer in inbox_items / agent_drafts touches.

import type { ProactiveRule, DetectedIssue } from "../types";

const HORIZON_HOURS = 24;

export const classroomDeadlineImminentRule: ProactiveRule = {
  name: "classroom_deadline_imminent",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    const horizon = new Date(
      snapshot.now.getTime() + HORIZON_HOURS * 3600 * 1000
    );

    for (const ev of snapshot.calendarEvents) {
      if (ev.sourceType !== "google_classroom_coursework") continue;
      if (ev.startsAt < snapshot.now) continue;
      if (ev.startsAt > horizon) continue;

      // Skip already-turned-in / graded coursework. The Classroom sync
      // flips state→TURNED_IN/RETURNED which maps to status='completed'
      // on the events row. Anything else (needs_action / null) is fair
      // game.
      if (ev.status === "completed") continue;

      const hoursLeft = Math.max(
        1,
        Math.ceil((ev.startsAt.getTime() - snapshot.now.getTime()) / (3600 * 1000))
      );

      issues.push({
        issueType: "classroom_deadline_imminent",
        sourceRecordIds: [ev.id],
        issueSummary: `「${ev.title}」の締切まで ${hoursLeft}時間`,
        reasoning: `Google Classroom coursework "${ev.title}" is due in ${hoursLeft}h (${formatDate(
          ev.startsAt
        )}). Status is still ${ev.status ?? "open"} — no turn-in recorded. Either submit now or ask for the extension before the deadline slips, not after.`,
        sourceRefs: [
          {
            kind: "calendar_event",
            id: ev.id,
            label: ev.title,
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
