// Rule 5 — Workload over capacity.
// Sliding 7-day window where the total estimated assignment hours
// exceeds 30. The estimate per assignment defaults to 3h when the
// snapshot doesn't carry one — assignments table doesn't store it
// today; PR 2+ may add a manual estimate column. Until then, this
// rule fires conservatively (heuristic estimate × count), keeping
// false positives in check.

import type { ProactiveRule, DetectedIssue } from "../types";

const WINDOW_DAYS = 7;
const HOURS_BUDGET = 30;
const DEFAULT_ASSIGNMENT_HOURS = 3;

export const workloadOverCapacityRule: ProactiveRule = {
  name: "workload_over_capacity",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    const dueAssignments = snapshot.assignments
      .filter((a) => a.dueAt && a.dueAt >= snapshot.now)
      .sort((a, b) => (a.dueAt!.getTime() - b.dueAt!.getTime()));

    if (dueAssignments.length === 0) return issues;

    // Slide a 7-day window starting at each assignment's dueAt; whenever
    // the count of assignments inside the window crosses the budget,
    // emit one issue keyed off the window start. Cap to one issue
    // per scan (post-α): repeat alerts confuse the user.
    const flagged = new Set<string>();
    for (let i = 0; i < dueAssignments.length; i++) {
      const start = dueAssignments[i].dueAt!;
      const windowEnd = new Date(
        start.getTime() + WINDOW_DAYS * 24 * 3600 * 1000
      );
      const inWindow = dueAssignments.filter(
        (a) => a.dueAt! >= start && a.dueAt! <= windowEnd
      );
      const totalHours =
        inWindow.reduce(
          (sum, a) => sum + (a.estimatedHours ?? DEFAULT_ASSIGNMENT_HOURS),
          0
        );
      if (totalHours <= HOURS_BUDGET) continue;

      const windowKey = start.toISOString().slice(0, 10);
      if (flagged.has(windowKey)) continue;
      flagged.add(windowKey);

      const titles = inWindow
        .map((a) => `「${a.title}」`)
        .slice(0, 5)
        .join("、");
      issues.push({
        issueType: "workload_over_capacity",
        sourceRecordIds: inWindow.map((a) => a.id),
        issueSummary: `${windowKey} 起点の 7日間に ${inWindow.length} 件の課題 (~${Math.round(
          totalHours
        )}h)`,
        reasoning: `In the 7-day window starting ${windowKey}, ${
          inWindow.length
        } assignments are due (${titles}${
          inWindow.length > 5 ? `、他 ${inWindow.length - 5} 件` : ""
        }). Estimated total: ~${Math.round(totalHours)}h, well past a sustainable 30h ceiling. Either reorder priorities now or request an extension on the lowest-stakes one before the week starts.`,
        sourceRefs: inWindow.slice(0, 5).map((a) => ({
          kind: "assignment" as const,
          id: a.id,
          label: a.title,
        })),
      });
      // Stop after the first flagged window — see comment above.
      break;
    }
    return issues;
  },
};
