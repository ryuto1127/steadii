// Recency-bucket helper for the /app/chats history page. Mirrors the
// grouping users see on Gmail / Linear / Slack: "Today" / "Yesterday"
// / "This week" / "Earlier". The buckets are computed in the viewer's
// local timezone — caller passes `now` so tests can pin it without
// monkey-patching Date.
export type ChatRecencyBucket = "today" | "yesterday" | "week" | "earlier";

export function bucketForDate(d: Date, now: Date = new Date()): ChatRecencyBucket {
  const startOfNowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round(
    (startOfNowDay.getTime() - startOfTarget.getTime()) / dayMs
  );
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return "week";
  return "earlier";
}

export const CHAT_RECENCY_BUCKET_ORDER: readonly ChatRecencyBucket[] = [
  "today",
  "yesterday",
  "week",
  "earlier",
] as const;

export function groupByBucket<T>(
  rows: readonly T[],
  getDate: (row: T) => Date,
  now: Date = new Date()
): Record<ChatRecencyBucket, T[]> {
  const out: Record<ChatRecencyBucket, T[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const row of rows) out[bucketForDate(getDate(row), now)].push(row);
  return out;
}
