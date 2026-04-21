import "server-only";

// Given a wall-clock local date+time and an IANA timezone, return the UTC
// instant that represents that wall-clock moment in the given zone.
//
// Works by:
//  1. computing the naive Date.UTC of the wall-clock components
//  2. formatting that naive UTC instant in `tz` to see what wall-clock it
//     produces (this effectively gives us the tz's offset on that date)
//  3. subtracting the observed offset to get the true UTC instant
//
// Handles DST boundaries correctly except for the theoretical ambiguous
// "fall-back" hour, which we treat as the earlier (wall-time) instant.
export function wallTimeInZoneToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string
): Date {
  const naive = Date.UTC(y, m - 1, d, h, mi, s);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(naive));
  const g = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    return v ? Number(v) : 0;
  };
  const wallH = g("hour") === 24 ? 0 : g("hour");
  const wallUtc = Date.UTC(g("year"), g("month") - 1, g("day"), wallH, g("minute"), g("second"));
  const offsetMs = wallUtc - naive;
  return new Date(naive - offsetMs);
}

// "YYYY-MM-DD" in zone `tz` → UTC instant at local midnight.
export function localMidnightAsUtc(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return wallTimeInZoneToUtc(y, m, d, 0, 0, 0, tz);
}

// Add N days to a "YYYY-MM-DD" string without touching tz or parsing.
export function addDaysToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

export const FALLBACK_TZ = "UTC";
