import "server-only";
import { z } from "zod";
import { getUserLocale } from "@/lib/agent/preferences";
import type { ToolExecutor } from "./types";

// engineer-45 — deterministic TZ conversion tool. Replaces LLM math (which
// is unreliable, per 2026-05-12 dogfood: agent silently mis-applied JST→PT
// offset multiple times in one conversation). Implementation uses
// Intl.DateTimeFormat with timeZone option — no manual offset math.

const args = z.object({
  // Either an ISO 8601 with explicit offset, OR a wall-clock string
  // (YYYY-MM-DDTHH:mm[:ss]) that gets anchored to `fromTz`.
  time: z.string().min(1).max(64),
  fromTz: z.string().min(1).max(64),
  toTz: z.string().min(1).max(64),
});

export type ConvertTimezoneResult = {
  toIso: string;
  toDisplay: string;
  fromDisplay: string;
  weekdayChanged: boolean;
};

export const convertTimezone: ToolExecutor<
  z.infer<typeof args>,
  ConvertTimezoneResult
> = {
  schema: {
    name: "convert_timezone",
    description:
      "Convert a wall-clock time from one IANA timezone to another. Deterministic — use this whenever you need to translate a time across timezones. Don't math it yourself. `time` is either an ISO 8601 timestamp with an explicit offset OR a wall-clock string like '2026-05-15T10:00:00' anchored to `fromTz`. `fromTz` and `toTz` are IANA names (e.g. 'Asia/Tokyo', 'America/Vancouver'). Returns the converted ISO timestamp with `toTz`'s offset, plus human-readable display strings in both zones. Handles DST automatically.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        time: { type: "string" },
        fromTz: { type: "string" },
        toTz: { type: "string" },
      },
      required: ["time", "fromTz", "toTz"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const locale = await getUserLocale(ctx.userId);
    return convertTimezoneSync({
      time: parsed.time,
      fromTz: parsed.fromTz,
      toTz: parsed.toTz,
      locale,
    });
  },
};

// Pure conversion function — exported for tests and reuse from non-tool
// callers (the draft prompt builder uses it to compose dual-TZ slot strings).
export function convertTimezoneSync(args: {
  time: string;
  fromTz: string;
  toTz: string;
  locale: "en" | "ja";
}): ConvertTimezoneResult {
  const { time, fromTz, toTz, locale } = args;

  // Validate the IANA zones eagerly so a typo surfaces here, not deep
  // inside Intl.format where the error message is opaque.
  assertValidIanaTimezone(fromTz, "fromTz");
  assertValidIanaTimezone(toTz, "toTz");

  const instant = parseToInstant(time, fromTz);

  const toIso = formatIsoWithOffset(instant, toTz);
  const toDisplay = formatHumanDisplay(instant, toTz, locale);
  const fromDisplay = formatHumanDisplay(instant, fromTz, locale);
  const weekdayChanged = computeWeekdayChanged(instant, fromTz, toTz);

  return { toIso, toDisplay, fromDisplay, weekdayChanged };
}

function assertValidIanaTimezone(tz: string, paramName: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`Invalid IANA timezone for ${paramName}: ${tz}`);
  }
}

// Parse `time` into an absolute UTC instant. If the string already has
// an explicit offset (Z or ±HH:MM), Date can parse it directly. Otherwise
// treat it as a wall-clock string in `fromTz` and back-solve to UTC.
function parseToInstant(time: string, fromTz: string): Date {
  if (hasExplicitOffset(time)) {
    const d = new Date(time);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid time string: ${time}`);
    }
    return d;
  }
  return wallClockToUtc(time, fromTz);
}

function hasExplicitOffset(s: string): boolean {
  if (s.endsWith("Z") || s.endsWith("z")) return true;
  // Look for ±HH:MM after a digit (so leading "-" in "2026-..." doesn't match).
  return /\d[+-]\d{2}:?\d{2}$/.test(s);
}

// Anchor a wall-clock "YYYY-MM-DDTHH:mm[:ss]" string to `tz` and return
// the corresponding UTC instant. We do this by:
//   1. Guess: treat the string as UTC, get a candidate Date
//   2. Format that candidate in `tz`, see what wall-clock comes out
//   3. The delta between the guess's wall-clock-in-tz and the desired
//      wall-clock IS the tz's UTC offset; subtract it to get the true UTC
//   4. Re-check (DST boundaries can shift the offset by 1h; one extra
//      iteration converges in all practical cases).
function wallClockToUtc(time: string, tz: string): Date {
  const wall = parseWallClock(time);
  let guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  for (let i = 0; i < 2; i++) {
    const offsetMs = computeOffsetMs(new Date(guess), tz);
    guess = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second
    ) - offsetMs;
  }
  return new Date(guess);
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseWallClock(s: string): WallClock {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) {
    throw new Error(`Unrecognized wall-clock format: ${s}`);
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
}

// Returns the offset (in ms) from UTC to `tz` at the given instant. E.g.
// Asia/Tokyo → +9h = +32400000. Uses Intl with timeZoneName=longOffset.
function computeOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const offsetRaw = get("timeZoneName"); // "GMT+09:00" or "GMT" for UTC
  if (!offsetRaw || offsetRaw === "GMT") return 0;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offsetRaw);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const h = Number(m[2]);
  const min = Number(m[3] ?? "0");
  return sign * (h * 60 + min) * 60 * 1000;
}

// Format `instant` as ISO 8601 with the `tz` offset attached:
// e.g. "2026-05-15T10:00:00+09:00". Uses Intl for the wall-clock parts +
// the offset directly so DST is handled automatically.
function formatIsoWithOffset(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const offsetRaw = get("timeZoneName");
  const offset =
    offsetRaw && offsetRaw !== "GMT"
      ? offsetRaw.replace("GMT", "")
      : "+00:00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${offset}`;
}

// "5月14日(水) 18:00 PT" for ja, "Thu May 14 18:00 PT" for en. The TZ
// suffix uses Intl's `short` style (PT/PST/PDT/JST/etc). When Intl can't
// resolve a friendly abbreviation (some zones return GMT+9), we fall
// back to the IANA name so the prompt still has unambiguous TZ context.
function formatHumanDisplay(
  instant: Date,
  tz: string,
  locale: "en" | "ja"
): string {
  const intlLocale = locale === "ja" ? "ja-JP" : "en-US";
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    timeZone: tz,
    // ja "long" yields 5月15日(木); en "short" yields "May 15, Thu".
    month: locale === "ja" ? "long" : "short",
    day: "numeric",
    weekday: "short",
  });
  const timeFmt = new Intl.DateTimeFormat(intlLocale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const datePart = dateFmt.format(instant);
  const timePart = timeFmt.format(instant);
  const tzAbbr = resolveTzAbbreviation(instant, tz);
  return `${datePart} ${timePart} ${tzAbbr}`;
}

function resolveTzAbbreviation(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(instant);
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value;
  if (!abbr) return tz;
  // "GMT+9" style isn't friendly — fall back to IANA name in that case.
  if (/^GMT[+-]?\d/.test(abbr)) return tz;
  return abbr;
}

function computeWeekdayChanged(
  instant: Date,
  fromTz: string,
  toTz: string
): boolean {
  const fromDay = formatYmd(instant, fromTz);
  const toDay = formatYmd(instant, toTz);
  return fromDay !== toDay;
}

function formatYmd(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const CONVERT_TIMEZONE_TOOLS = [convertTimezone];
