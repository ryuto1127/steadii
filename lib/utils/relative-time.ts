// Short relative-time helper shared by the sidebar Recent chats list,
// the activity timeline, and any future surface that wants compact
// "3h" / "2d" / "4/12" style markers. Mirrors the inline helpers that
// previously lived in components/layout/sidebar.tsx and
// components/agent/recent-activity.tsx so we have a single source of
// truth instead of two near-identical implementations drifting apart.
export function shortRelativeTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
