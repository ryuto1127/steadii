// Rule 3 — Deadline during travel.
// An assignment dueAt falls inside a multi-day calendar event window.
// "Multi-day" is the critical filter: a 1-hour calendar event doesn't
// block a deadline; a 4-day trip does.

import type { ProactiveRule, DetectedIssue } from "../types";

const MIN_TRAVEL_HOURS = 24;

export const deadlineDuringTravelRule: ProactiveRule = {
  name: "deadline_during_travel",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];

    // Only events with explicit end times can be considered travel.
    // All-day single-day events covering one calendar day are treated
    // as 24h windows. Multi-day all-day events use the diff between
    // start and end.
    const travelWindows = snapshot.calendarEvents
      .map((evt) => {
        const start = evt.startsAt;
        const end = evt.endsAt ?? evt.startsAt;
        const hours = (end.getTime() - start.getTime()) / (3600 * 1000);
        return { evt, start, end, hours };
      })
      .filter((w) => w.hours >= MIN_TRAVEL_HOURS);

    for (const w of travelWindows) {
      for (const a of snapshot.assignments) {
        if (!a.dueAt) continue;
        if (a.dueAt < w.start || a.dueAt > w.end) continue;

        issues.push({
          issueType: "deadline_during_travel",
          sourceRecordIds: [a.id, w.evt.id],
          issueSummary: `「${a.title}」の deadline が「${w.evt.title}」中`,
          reasoning: `Assignment "${a.title}" is due ${formatDate(
            a.dueAt
          )}. That falls inside the calendar block "${w.evt.title}" (${formatDate(
            w.start
          )} – ${formatDate(w.end)}, ${Math.round(w.hours)}h). Either move the trip, finish early, or request an extension — pick now, not at 11pm the night before.`,
          sourceRefs: [
            { kind: "assignment", id: a.id, label: a.title },
            { kind: "calendar_event", id: w.evt.id, label: w.evt.title },
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
