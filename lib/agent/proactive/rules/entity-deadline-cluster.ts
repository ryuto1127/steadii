// engineer-51 — entity_deadline_cluster proactive rule.
//
// Detects entities (project / course / org typically) with 3+ linked
// assignments or calendar events clustered in the next 7 days. Fires
// a Type C card: "{entityName}: 3 deadlines this week. Worth blocking
// time?" The dedup key includes the sorted source IDs so a fresh
// cluster (a new assignment lands → bump the count from 3 to 4) does
// fire a new card.

import type { ProactiveRule, DetectedIssue, UserSnapshot } from "../types";

const CLUSTER_THRESHOLD = 3;
const APPLICABLE_KINDS = new Set(["project", "course", "org", "event_series"]);

export const entityDeadlineClusterRule: ProactiveRule = {
  name: "entity_deadline_cluster",
  detect(snapshot: UserSnapshot): DetectedIssue[] {
    const issues: DetectedIssue[] = [];
    for (const sig of snapshot.entitySignals) {
      if (!APPLICABLE_KINDS.has(sig.kind)) continue;
      if (sig.upcomingItemCount < CLUSTER_THRESHOLD) continue;
      issues.push(buildIssue(sig));
    }
    return issues;
  },
};

function buildIssue(
  sig: UserSnapshot["entitySignals"][number]
): DetectedIssue {
  const sortedRefs = [...sig.upcomingItemRefs].sort(
    (a, b) => a.occursAt.getTime() - b.occursAt.getTime()
  );
  const sourceRecordIds = [sig.entityId, ...sortedRefs.map((r) => r.id)];

  const summary = `「${sig.displayName}」に${sig.upcomingItemCount}件の締切が今週集中`;
  const reasoning = `Entity "${sig.displayName}" (${sig.kind}) has ${sig.upcomingItemCount} linked deadlines / events in the next 7 days: ${sortedRefs
    .slice(0, 5)
    .map((r) => r.title)
    .join(", ")}. Worth blocking dedicated time on the calendar.`;

  return {
    issueType: "entity_deadline_cluster",
    sourceRecordIds,
    issueSummary: summary,
    reasoning,
    sourceRefs: [
      {
        kind: "entity",
        id: sig.entityId,
        label: sig.displayName,
      },
      ...sortedRefs.slice(0, 5).map((r) => ({
        kind:
          r.kind === "assignment"
            ? ("assignment" as const)
            : ("calendar_event" as const),
        id: r.id,
        label: r.title,
      })),
    ],
  };
}
