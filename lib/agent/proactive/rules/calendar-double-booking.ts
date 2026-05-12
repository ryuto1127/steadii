// engineer-43 — Calendar double-booking.
// Two or more calendar events overlap in time. Distinct from time_conflict
// (event vs. syllabus block) and exam_conflict (event vs. exam window) —
// this catches the plain "you accepted two meetings at 2pm" case that
// the syllabus-dependent rules miss for non-syllabus-bound users.
//
// All-day events are excluded — they overlap everything by definition.
// Self-class blocks (calendar events whose title carries the class code)
// stay in the comparison since real double-bookings can absolutely
// involve a class.

import type { ProactiveRule, DetectedIssue } from "../types";

export const calendarDoubleBookingRule: ProactiveRule = {
  name: "calendar_double_booking",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];

    // Drop all-day events and assignment-kind events. Classroom coursework
    // gets stored as an event with startsAt = dueDate; treating those as
    // overlapping every scheduled meeting on the day would surface noise.
    const live = snapshot.calendarEvents.filter(
      (e) =>
        !e.isAllDay &&
        e.sourceType !== "google_classroom_coursework" &&
        e.sourceType !== "google_tasks" &&
        e.sourceType !== "microsoft_todo"
    );

    // O(n²) is fine — most users carry <100 events in the 90-day window
    // and the inner-loop is a cheap range check.
    const seenPairs = new Set<string>();
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      const aEnd = a.endsAt ?? a.startsAt;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const bEnd = b.endsAt ?? b.startsAt;
        // Strict-overlap check: end-exclusive so back-to-back meetings
        // don't false-positive.
        const overlaps = a.startsAt < bEnd && b.startsAt < aEnd;
        if (!overlaps) continue;

        // Trivial self-match: same externalId across sources (a rare
        // sync race). Skip — same event surfaced twice isn't a conflict.
        if (a.externalId && a.externalId === b.externalId) continue;

        // Dedup mirror pairs (i,j) vs (j,i) by sorting ids.
        const pairKey = [a.id, b.id].sort().join(":");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        issues.push({
          issueType: "calendar_double_booking",
          sourceRecordIds: [a.id, b.id].sort(),
          issueSummary: `「${a.title}」と「${b.title}」が同時刻`,
          reasoning: `Calendar has two events overlapping: "${a.title}" (${formatRange(
            a.startsAt,
            aEnd
          )}) and "${b.title}" (${formatRange(
            b.startsAt,
            bEnd
          )}). One needs to move, decline, or split — better now than at the start of the slot.`,
          sourceRefs: [
            { kind: "calendar_event", id: a.id, label: a.title },
            { kind: "calendar_event", id: b.id, label: b.title },
          ],
        });
      }
    }

    return issues;
  },
};

function formatRange(start: Date, end: Date): string {
  const s = start.toISOString().slice(0, 16).replace("T", " ");
  const e = end.toISOString().slice(11, 16);
  return `${s} – ${e}`;
}
