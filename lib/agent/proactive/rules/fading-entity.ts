// engineer-51 — entity_fading proactive rule.
//
// Detects entities (especially person kind) the user has touched far
// less recently than their historical cadence implies. Fires a Type C
// card: "You haven't talked to {entityName} in {N} days. Used to be
// every {M} days. Drifted on purpose?"
//
// Detection criteria:
//   - Entity must have meanGapDays computed (≥ 4 historical links).
//   - daysSinceLastLink must exceed meanGapDays + 2 × stddevGapDays
//     (i.e. statistical-anomaly territory).
//   - daysSinceLastLink must be at least 7 days — drift inside a week
//     is noise.
//   - Cap to person + project + org. Course / event_series cadence
//     is structured (term-bound) so the "drifted" framing doesn't
//     apply.

import type { ProactiveRule, DetectedIssue, UserSnapshot } from "../types";

const MIN_DAYS_TO_FIRE = 7;
const STDDEV_MULTIPLIER = 2;
const APPLICABLE_KINDS = new Set(["person", "project", "org"]);

export const fadingEntityRule: ProactiveRule = {
  name: "entity_fading",
  detect(snapshot: UserSnapshot): DetectedIssue[] {
    const issues: DetectedIssue[] = [];
    for (const sig of snapshot.entitySignals) {
      if (!APPLICABLE_KINDS.has(sig.kind)) continue;
      if (sig.meanGapDays === null || sig.stddevGapDays === null) continue;
      if (sig.daysSinceLastLink < MIN_DAYS_TO_FIRE) continue;
      const threshold = sig.meanGapDays + STDDEV_MULTIPLIER * sig.stddevGapDays;
      if (sig.daysSinceLastLink < threshold) continue;

      issues.push(buildIssue(sig));
    }
    return issues;
  },
};

function buildIssue(
  sig: UserSnapshot["entitySignals"][number]
): DetectedIssue {
  const meanRounded = Math.round(sig.meanGapDays ?? 0);
  const summary = `「${sig.displayName}」と${sig.daysSinceLastLink}日連絡なし（通常${meanRounded}日に1回）`;
  const reasoning = `Entity "${sig.displayName}" (${sig.kind}): you've gone ${sig.daysSinceLastLink} days without a linked email / event / chat / draft. Historical mean gap between touches is ~${meanRounded} days (σ ≈ ${(sig.stddevGapDays ?? 0).toFixed(1)}d). Drifted on purpose or worth a check-in?`;

  return {
    issueType: "entity_fading",
    sourceRecordIds: [sig.entityId],
    issueSummary: summary,
    reasoning,
    sourceRefs: [
      {
        kind: "entity",
        id: sig.entityId,
        label: sig.displayName,
      },
    ],
  };
}
