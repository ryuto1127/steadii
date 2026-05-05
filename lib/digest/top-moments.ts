// Pure "top 3 moments" picker for the weekly retrospective digest.
//
// Heuristic priority (memory-locked in the handoff doc):
//   1. HIGH-risk drafts that user sent UNMODIFIED (= Steadii nailed a hard one)
//   2. Drafts/proposals with deadline keywords in subject
//      (`deadline`, `due`, `期限`, `締切`, `提出`, `submit`)
//   3. Calendar imports from syllabus (= proactive catch)
//
// Ties break by recency (newest first). Cap at 3 entries by default.

export type MomentSource = "draft" | "proposal" | "calendar_import";

export type MomentCandidate = {
  id: string;
  source: MomentSource;
  // Subject / summary used for the narrative line in the email.
  subject: string;
  // Optional sender / class / context for richer phrasing.
  context?: string;
  occurredAt: Date;
  // Only meaningful when source==='draft'. Tier of the original
  // draft; "high"-tier sent without edits earns priority 1.
  riskTier?: "low" | "medium" | "high";
  // Only meaningful when source==='draft'. True when the user
  // hit Send without modifying the body Steadii drafted.
  sentUnmodified?: boolean;
};

export type SelectedMoment = MomentCandidate & {
  priority: 1 | 2 | 3;
};

const DEADLINE_KEYWORDS = [
  "deadline",
  "due",
  "期限",
  "締切",
  "提出",
  "submit",
];

export function hasDeadlineKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return DEADLINE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function priorityOf(c: MomentCandidate): 1 | 2 | 3 | null {
  // Priority 1 — HIGH-tier draft sent without edits. The hardest class
  // of work to get right; landing it untouched is the moment we want to
  // surface first.
  if (c.source === "draft" && c.riskTier === "high" && c.sentUnmodified) {
    return 1;
  }
  // Priority 2 — anything tagged with a deadline keyword. We check the
  // subject (and context for proposals where the issue summary is the
  // primary signal). Deadline-relevant work is the second-most "felt"
  // category for a student looking back at the week.
  if (
    hasDeadlineKeyword(c.subject) ||
    hasDeadlineKeyword(c.context ?? null)
  ) {
    return 2;
  }
  // Priority 3 — calendar imports are quietly valuable; surface as the
  // catch-all "Steadii spotted this for you" tier.
  if (c.source === "calendar_import") {
    return 3;
  }
  return null;
}

export function selectTopMoments(
  candidates: MomentCandidate[],
  limit = 3
): SelectedMoment[] {
  const ranked: SelectedMoment[] = [];
  for (const c of candidates) {
    const p = priorityOf(c);
    if (p === null) continue;
    ranked.push({ ...c, priority: p });
  }
  ranked.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.occurredAt.getTime() - a.occurredAt.getTime();
  });
  return ranked.slice(0, limit);
}
