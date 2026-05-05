// Pure time-saved estimator for the weekly retrospective digest and the
// /app/activity stats card. Conservative per-action seconds:
//
//   archived (auto-archive)    →  8s   (skim + archive in Gmail)
//   draft sent unmodified      → 75s   (compose, re-read, send)
//   draft sent after edit      → 25s   (the edit happened, but the
//                                       boilerplate + greeting + sign-off
//                                       Steadii drafted is still saved)
//   calendar event imported    → 45s   (open syllabus, find date, copy
//                                       into calendar, set reminder)
//   proposal resolved          → 30s   (notice, decide, dismiss/act)
//
// The numbers are deliberately on the low end of the plausible range —
// the goal is for the user to think "actually, that's about right" when
// the email lands, not "huh, that feels inflated".

export type WeeklyStats = {
  archivedCount: number;
  draftsSentUnmodified: number;
  draftsSentEdited: number;
  calendarImports: number;
  proposalsResolved: number;
};

export const SECONDS_PER_ACTION = {
  archived: 8,
  draftSentUnmodified: 75,
  draftSentEdited: 25,
  calendarImport: 45,
  proposalResolved: 30,
} as const;

export function estimateSecondsSaved(stats: WeeklyStats): number {
  return (
    stats.archivedCount * SECONDS_PER_ACTION.archived +
    stats.draftsSentUnmodified * SECONDS_PER_ACTION.draftSentUnmodified +
    stats.draftsSentEdited * SECONDS_PER_ACTION.draftSentEdited +
    stats.calendarImports * SECONDS_PER_ACTION.calendarImport +
    stats.proposalsResolved * SECONDS_PER_ACTION.proposalResolved
  );
}

// "~3m 12s" / "~1h 04m" / "0s". Used in subject + body. Keeps Japanese
// formatting parity (numerals + JP units handled at render-site).
export function formatSecondsSaved(seconds: number): string {
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const totalMinutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (totalMinutes < 60) {
    if (remSeconds === 0) return `${totalMinutes}m`;
    return `${totalMinutes}m ${String(remSeconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${String(remMinutes).padStart(2, "0")}m`;
}

export function formatSecondsSavedJa(seconds: number): string {
  if (seconds <= 0) return "0秒";
  if (seconds < 60) return `${seconds}秒`;
  const totalMinutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (totalMinutes < 60) {
    if (remSeconds === 0) return `${totalMinutes}分`;
    return `${totalMinutes}分${remSeconds}秒`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (remMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remMinutes}分`;
}
