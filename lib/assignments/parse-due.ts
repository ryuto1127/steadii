// engineer-44 — Natural-language due-date parser for the
// `assignments_create` agent tool. Pure (no DB, no server-only) so the
// test suite can hammer it without spinning up a full env.
//
// Inputs we accept:
//   - ISO date/time: "2026-05-20", "2026-05-20T17:00", "2026-05-20T17:00:00Z"
//   - Relative EN: "today", "tomorrow", "in 3 days", "in 2 weeks",
//     "next Friday", "this Friday", "Friday" (resolves to upcoming)
//   - Relative JA: 「今日」「明日」「あさって」「来週水曜」「再来週月曜」、
//     「3日後」「2週間後」、「水曜」(resolves to upcoming)
//   - Absolute JA: "12月5日", "12月5日 17:00"
//   - Slash/dash: "12/5", "12-5", "12/5 17:00"
//
// All output Dates are UTC instants. Time-of-day defaults to 23:59 local
// (end-of-day) when not specified — students think of an assignment due
// "Friday" as "Friday EOD", not "Friday midnight" — both options are
// imperfect; EOD matches what professors typically mean by a deadline.
//
// Time-of-day fallback uses the supplied IANA timezone to compute the
// EOD wall clock, then converts to UTC. Caller passes the user's tz
// (defaults to UTC at the call site).

import { wallTimeInZoneToUtc } from "@/lib/calendar/tz-utils";

const DEFAULT_EOD_HOUR = 23;
const DEFAULT_EOD_MIN = 59;

const EN_WEEKDAY: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const JA_WEEKDAY: Record<string, number> = {
  "日": 0, "日曜": 0, "日曜日": 0,
  "月": 1, "月曜": 1, "月曜日": 1,
  "火": 2, "火曜": 2, "火曜日": 2,
  "水": 3, "水曜": 3, "水曜日": 3,
  "木": 4, "木曜": 4, "木曜日": 4,
  "金": 5, "金曜": 5, "金曜日": 5,
  "土": 6, "土曜": 6, "土曜日": 6,
};

export type ParseDueResult =
  | { ok: true; date: Date; hadTime: boolean }
  | { ok: false; reason: string };

export function parseDueDate(
  input: string,
  opts: { now?: Date; timezone?: string } = {}
): ParseDueResult {
  const tz = opts.timezone ?? "UTC";
  const now = opts.now ?? new Date();
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty input" };

  // 1. ISO. Date constructor parses "YYYY-MM-DD" as UTC midnight which
  // is fine for date-only — we treat it as 23:59 local end-of-day. For
  // full ISO timestamps (with time / Z / offset), we preserve as-is.
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(raw)) {
    if (raw.length === 10) {
      // Date-only — bump to EOD local
      const [y, m, d] = raw.split("-").map(Number);
      return {
        ok: true,
        date: wallTimeInZoneToUtc(y, m, d, DEFAULT_EOD_HOUR, DEFAULT_EOD_MIN, 0, tz),
        hadTime: false,
      };
    }
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return { ok: true, date: dt, hadTime: true };
    }
  }

  // 2. JA absolute: "12月5日", "12月5日 17:00"
  const jaAbs = raw.match(
    /^(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?$/
  );
  if (jaAbs) {
    const [, m, d, hh, mm] = jaAbs;
    const year = pickYearForMonthDay(Number(m), Number(d), now);
    if (hh && mm) {
      return {
        ok: true,
        date: wallTimeInZoneToUtc(year, Number(m), Number(d), Number(hh), Number(mm), 0, tz),
        hadTime: true,
      };
    }
    return {
      ok: true,
      date: wallTimeInZoneToUtc(year, Number(m), Number(d), DEFAULT_EOD_HOUR, DEFAULT_EOD_MIN, 0, tz),
      hadTime: false,
    };
  }

  // 3. Slash / dash absolute: "12/5", "12-5", "12/5 17:00"
  const slash = raw.match(
    /^(\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/
  );
  if (slash) {
    const [, m, d, hh, mm] = slash;
    const year = pickYearForMonthDay(Number(m), Number(d), now);
    if (hh && mm) {
      return {
        ok: true,
        date: wallTimeInZoneToUtc(year, Number(m), Number(d), Number(hh), Number(mm), 0, tz),
        hadTime: true,
      };
    }
    return {
      ok: true,
      date: wallTimeInZoneToUtc(year, Number(m), Number(d), DEFAULT_EOD_HOUR, DEFAULT_EOD_MIN, 0, tz),
      hadTime: false,
    };
  }

  const lower = raw.toLowerCase();

  // 4. EN "today" / "tomorrow"
  if (lower === "today") return eodInTz(now, 0, tz);
  if (lower === "tomorrow" || lower === "tmrw" || lower === "tmr") return eodInTz(now, 1, tz);
  if (raw === "今日") return eodInTz(now, 0, tz);
  if (raw === "明日") return eodInTz(now, 1, tz);
  if (raw === "あさって" || raw === "明後日") return eodInTz(now, 2, tz);

  // 5. "in N days|weeks" / "Nd"
  const inN = lower.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/);
  if (inN) {
    const n = Number(inN[1]);
    const days = inN[2].startsWith("week") ? n * 7 : n;
    return eodInTz(now, days, tz);
  }

  // 6. JA "N日後" / "N週間後"
  const jaIn = raw.match(/^(\d+)(日|週間)後$/);
  if (jaIn) {
    const n = Number(jaIn[1]);
    const days = jaIn[2] === "週間" ? n * 7 : n;
    return eodInTz(now, days, tz);
  }

  // 7. EN weekday: "next Friday", "this Friday", "Friday"
  const enWeekday = lower.match(
    /^(?:(next|this|coming)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/
  );
  if (enWeekday) {
    const [, qual, name] = enWeekday;
    const targetDow = EN_WEEKDAY[name];
    const days = daysUntilWeekday(now, targetDow, qual === "next" ? "next-week" : "upcoming");
    return eodInTz(now, days, tz);
  }

  // 8. JA weekday: "来週水曜", "再来週月", "今週金", "水曜"
  const jaWeekday = raw.match(
    /^(今週|来週|再来週)?(日|月|火|水|木|金|土)(?:曜日?)?$/
  );
  if (jaWeekday) {
    const [, qual, dayChar] = jaWeekday;
    const targetDow = JA_WEEKDAY[dayChar];
    let mode: "upcoming" | "next-week" | "two-weeks" = "upcoming";
    if (qual === "来週") mode = "next-week";
    else if (qual === "再来週") mode = "two-weeks";
    const days = daysUntilWeekday(now, targetDow, mode);
    return eodInTz(now, days, tz);
  }

  // 9. Final fallback: try the raw string against Date()
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return { ok: true, date: fallback, hadTime: true };
  }

  return { ok: false, reason: `unparseable date "${raw}"` };
}

function eodInTz(
  now: Date,
  daysAhead: number,
  tz: string
): ParseDueResult {
  // Compute the wall-clock date in `tz` for `now + daysAhead`, then
  // pin time to EOD local. Use the tz formatter to get the local date.
  const target = new Date(now.getTime() + daysAhead * 86400 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return {
    ok: true,
    date: wallTimeInZoneToUtc(y, m, d, DEFAULT_EOD_HOUR, DEFAULT_EOD_MIN, 0, tz),
    hadTime: false,
  };
}

// Day delta from "now" (in tz; we approximate via UTC since the small
// drift across day boundaries near midnight is acceptable for this UX —
// the wall-clock EOD pin in eodInTz fixes it) to the next occurrence
// of `targetDow`.
//   - "upcoming": next occurrence including today + 0..6
//   - "next-week": skip the current week, land in the next Mon-Sun bucket
//   - "two-weeks": skip two weeks
function daysUntilWeekday(
  now: Date,
  targetDow: number,
  mode: "upcoming" | "next-week" | "two-weeks"
): number {
  const currentDow = now.getUTCDay();
  let diff = (targetDow - currentDow + 7) % 7;
  // "upcoming" with same-day match (diff=0) means today — that's correct
  // for "Friday" said on a Friday afternoon. But if the user said "next
  // Friday" on a Friday, they mean the *next* one.
  if (mode === "next-week") {
    if (diff <= 6) diff += 7;
  } else if (mode === "two-weeks") {
    diff += 14;
  }
  return diff;
}

// When the user says "12/5" in June, they mean THIS year (December).
// When they say "3/15" in October, they mean NEXT year. Heuristic: if
// the month/day combo already passed this year (more than 1 day ago to
// avoid same-day false-rolls), bump to next year.
function pickYearForMonthDay(
  month: number,
  day: number,
  now: Date
): number {
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  // 1-day grace: if it's "today" the user clearly means today, not next year.
  const oneDayAgo = new Date(now.getTime() - 86400 * 1000);
  if (candidate < oneDayAgo) return year + 1;
  return year;
}
