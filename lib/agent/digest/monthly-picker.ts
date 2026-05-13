import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { monthlyDigests } from "./monthly-digests-table";
import { hourInTimezone } from "@/lib/digest/picker";
import { dayOfWeekInTimezone } from "@/lib/digest/weekly-picker";

// engineer-50 — Picker for the monthly digest cron.
//
// The cron fires daily at 09:00 UTC. For each enabled user we resolve
// their local-tz date and check if today is the FIRST SUNDAY of the
// month in their timezone AND the cron hour aligns with a per-user
// digest-hour preference (defaults to 9 local). Picking the first
// Sunday gives the user a week of the new month already covered before
// the digest arrives (so the comparison-to-prior-month framing reads
// naturally) and falls on a low-load day for most students.

export type MonthlyDigestCandidate = {
  userId: string;
  email: string;
  timezone: string;
};

export async function pickEligibleUsersForMonthlyTick(
  now: Date = new Date()
): Promise<MonthlyDigestCandidate[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      // Reuse the existing digest-hour column for delivery hour; users
      // who customized their morning digest hour get the monthly at
      // the same wall-clock time. Defaulting to 9 keeps it consistent
      // with the cron's nominal 09:00 UTC fire even for UTC-anchored
      // users.
      digestHourLocal: users.digestHourLocal,
    })
    .from(users)
    .where(
      and(
        // Reuse weeklyDigestEnabled as the master opt-in switch for the
        // CoS-mode monthly digest. The cadence is monthly so a separate
        // toggle isn't worth the schema bump; users who disabled the
        // weekly retrospective shouldn't see the monthly either —
        // they've opted out of email retrospective surfaces wholesale.
        eq(users.weeklyDigestEnabled, true),
        isNull(users.deletedAt),
        isNotNull(users.email)
      )
    );

  const eligible: MonthlyDigestCandidate[] = [];
  for (const row of rows) {
    const tz = row.timezone || "UTC";
    if (!isFirstSundayOfMonthInTimezone(now, tz)) continue;
    const localHour = hourInTimezone(now, tz);
    if (localHour === null) continue;
    if (localHour !== row.digestHourLocal) continue;
    eligible.push({
      userId: row.id,
      email: row.email,
      timezone: tz,
    });
  }
  return eligible;
}

// True when `now` falls on the first Sunday of the calendar month in
// the given IANA timezone. The cron checks this per-user; the daily
// 09:00 UTC fire is just the upper bound.
export function isFirstSundayOfMonthInTimezone(
  now: Date,
  tz: string
): boolean {
  const dow = dayOfWeekInTimezone(now, tz);
  if (dow !== 0) return false;
  const day = dayOfMonthInTimezone(now, tz);
  if (day === null) return false;
  // First Sunday = day 1..7.
  return day >= 1 && day <= 7;
}

// Day-of-month 1..31 in the given IANA timezone. Returns null on
// invalid tz. Pattern matches hourInTimezone / dayOfWeekInTimezone.
export function dayOfMonthInTimezone(now: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      day: "2-digit",
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "day")?.value ?? "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Resolve the half-open month boundaries [start, end) for the digest
// being generated. We're delivering on the first Sunday of THIS month,
// so the "covered" month is the PRIOR calendar month — i.e. the month
// the user just finished living through.
export function coveredMonthBoundsInTimezone(
  now: Date,
  tz: string
): { monthStart: Date; monthEnd: Date; label: string; isoMonthKey: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const yearStr = parts.find((p) => p.type === "year")?.value ?? "1970";
  const monthStr = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = Number(yearStr);
  const month = Number(monthStr); // 1..12

  // Prior month: subtract 1 with year-wrap.
  const priorYear = month === 1 ? year - 1 : year;
  const priorMonth = month === 1 ? 12 : month - 1;

  // Construct boundaries via the local-tz wall clock. The trick: an
  // "Asia/Tokyo 2026-04-01 00:00" instant is built by guessing UTC,
  // measuring the offset Intl reports, and adjusting once.
  const monthStart = wallClockToUtc({
    year: priorYear,
    month: priorMonth,
    day: 1,
    hour: 0,
    minute: 0,
    tz,
  });
  const monthEnd = wallClockToUtc({
    year,
    month,
    day: 1,
    hour: 0,
    minute: 0,
    tz,
  });

  // Locale-agnostic month label — the per-locale rendering happens in
  // the synthesis prompt / email template.
  const label = `${priorYear}-${String(priorMonth).padStart(2, "0")}`;
  const isoMonthKey = `${priorYear}-${String(priorMonth).padStart(2, "0")}`;
  return { monthStart, monthEnd, label, isoMonthKey };
}

// Convert a wall-clock moment in `tz` to a UTC Date instant. Pure JS,
// no luxon — keeps the bundle small at the cost of two Intl.format
// rounds per call. Caller responsibility: only invoke for trusted tz
// strings (the picker already filters invalid tz upstream).
export function wallClockToUtc(args: {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  tz: string;
}): Date {
  const { year, month, day, hour, minute, tz } = args;
  // 1. First guess: treat the wall clock as UTC.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  // 2. Measure the tz offset reported for that instant by Intl.
  const tzInstant = new Date(naiveUtc);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(tzInstant);
  const obsYear = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const obsMonth = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  const obsDay = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  const obsHourRaw = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Some Intl implementations emit "24" for midnight; normalize.
  const obsHour = obsHourRaw % 24;
  const obsMinute = Number(
    parts.find((p) => p.type === "minute")?.value ?? "0"
  );
  const observed = Date.UTC(
    obsYear,
    obsMonth - 1,
    obsDay,
    obsHour,
    obsMinute,
    0
  );
  // 3. The delta between the naive-UTC guess and the tz-observed
  //    wall-clock IS the tz offset. Subtract to land at the real UTC
  //    instant.
  const offset = observed - naiveUtc;
  return new Date(naiveUtc - offset);
}

// Did we already store a digest row for this user + month? Used by the
// cron to short-circuit the LLM call when the row already exists.
// Idempotent shortcut keyed on the half-open monthStart.
export async function digestExistsFor(
  userId: string,
  monthStart: Date
): Promise<boolean> {
  const rows = await db
    .select({ id: monthlyDigests.id })
    .from(monthlyDigests)
    .where(
      and(
        eq(monthlyDigests.userId, userId),
        eq(monthlyDigests.monthStart, monthStart)
      )
    )
    .limit(1);
  return rows.length > 0;
}

// Pull the prior-month synthesis JSON for a user so the LLM can carry
// themes across months. Returns null when no prior row exists (first
// digest for this user) — the synthesis prompt handles that branch.
// Caller must supply the precise prior-month start (recompute via
// wallClockToUtc on year - month math, not date arithmetic).
export async function loadPriorMonthSynthesis(
  userId: string,
  priorMonthStart: Date
): Promise<unknown | null> {
  const rows = await db
    .select({ synthesis: monthlyDigests.synthesis })
    .from(monthlyDigests)
    .where(
      and(
        eq(monthlyDigests.userId, userId),
        eq(monthlyDigests.monthStart, priorMonthStart)
      )
    )
    .limit(1);
  return rows[0]?.synthesis ?? null;
}

// Compute the prior calendar month's monthStart in the same tz as
// `coveredMonthBoundsInTimezone`. The covered month is M; the prior
// month is M-1; in absolute terms that's two months before `now`'s
// local calendar month.
export function priorMonthStartInTimezone(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const yearStr = parts.find((p) => p.type === "year")?.value ?? "1970";
  const monthStr = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Step back two months from `now`'s local month with year-wrap. We
  // want monthStart for month (M-2 in absolute terms, i.e. the month
  // before the one we're covering).
  let priorYear = year;
  let priorMonth = month - 2;
  while (priorMonth <= 0) {
    priorMonth += 12;
    priorYear -= 1;
  }
  return wallClockToUtc({
    year: priorYear,
    month: priorMonth,
    day: 1,
    hour: 0,
    minute: 0,
    tz,
  });
}
