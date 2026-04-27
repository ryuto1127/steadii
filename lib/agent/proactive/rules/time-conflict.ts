// Rule 1 — Time conflict.
// A calendar event overlaps a syllabus-derived class lecture block.
// "Overlap" here means the event's start..end window intersects the
// class block's start..end window in real time. All-day events are
// skipped because they don't carry a clock time we can compare.

import type { ProactiveRule, DetectedIssue } from "../types";

export const timeConflictRule: ProactiveRule = {
  name: "time_conflict",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    for (const evt of snapshot.calendarEvents) {
      if (evt.isAllDay) continue;
      const evtEnd = evt.endsAt ?? evt.startsAt;

      for (const block of snapshot.classTimeBlocks) {
        const overlaps =
          evt.startsAt < block.endsAt && evtEnd > block.startsAt;
        if (!overlaps) continue;

        // Skip the trivial self-match: a calendar event whose title
        // already references the class code or name is presumably the
        // class itself, imported.
        const titleLower = evt.title.toLowerCase();
        if (
          (block.classCode &&
            titleLower.includes(block.classCode.toLowerCase())) ||
          titleLower.includes(block.className.toLowerCase())
        ) {
          continue;
        }

        const labelDate = block.startsAt.toISOString().slice(0, 10);
        issues.push({
          issueType: "time_conflict",
          sourceRecordIds: [evt.id, `class:${block.classId}:${labelDate}`],
          issueSummary: `「${evt.title}」が ${block.className} の時間と重複`,
          reasoning: `Calendar event "${evt.title}" (${formatRange(
            evt.startsAt,
            evtEnd
          )}) overlaps the ${block.className}${
            block.classCode ? ` (${block.classCode})` : ""
          } class block (${formatRange(block.startsAt, block.endsAt)}).`,
          sourceRefs: [
            {
              kind: "calendar_event",
              id: evt.id,
              label: evt.title,
            },
            {
              kind: "class",
              id: block.classId,
              label: block.className,
            },
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
