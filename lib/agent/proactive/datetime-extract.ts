// 2026-05-27 — Shared pure date/time extraction for the auto-cal
// detectors (deadline + mutual-agreement + scheduled-event). Before
// this module each detector hand-rolled its own date regex, and NONE
// of them parsed English long-form dates ("October 14, 2026") or
// 12-hour AM/PM times ("4:00 PM") — only numeric/JA forms (6/2, 6月2日)
// and 24h times. For the Canadian/US student base, English long-form
// is the dominant calendar-date shape, so auto-cal silently no-op'd on
// most real mail.
//
// This module centralizes ONE month-name table + ONE time parser and
// returns positional matches so each detector can keep doing proximity
// binding (keyword-near-date) against the original body offsets.
//
// Pure: no DB, no LLM, no I/O. Deterministic regex + arithmetic only.
//
// We deliberately do NOT reach for temporal-polyfill / rrule-temporal
// here: those libraries do instant/recurrence math on already-parsed
// values, not free-text extraction with source offsets out of prose.
// The detectors need {index,length} to scope keyword proximity, which
// is exactly what a positional regex sweep gives us.

// A single date (+ optional time) mention found in free text. `index`
// / `length` are offsets into the SOURCE string so callers can scope
// proximity windows and quoted-history checks against the original body.
export type DateTimeMatch = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  // Present only when the match carried a clock time.
  hour?: number; // 0-23 (already normalized from 12h when AM/PM)
  minute?: number; // 0-59
  // Present only when the match was a time RANGE (e.g. "4:00 PM - 5:00 PM").
  // Minutes between start and end; callers use this as the event duration.
  durationMin?: number;
  // Offsets into the source string for the full matched span.
  index: number;
  length: number;
  // The raw matched substring — surfaced for glass-box reasoning.
  raw: string;
};

// ---------- month-name table (the single source of truth) ----------

// Full + 3-letter abbreviations, lowercased. Both "sept" and "sep" map
// to September; the regex below accepts an optional trailing ".".
const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// Alternation of every month token, longest-first so "september" wins
// over "sep" and the regex engine doesn't stop early on the prefix.
const MONTH_ALT = Object.keys(MONTH_NAME_TO_NUM)
  .sort((a, b) => b.length - a.length)
  .join("|");

// ---------- patterns ----------

// Numeric / JA date: 6/2, 6-2, 2026/6/2, 6月2日, 6/2(水), optionally
// followed by a 24h clock time "14:00". Kept byte-for-byte compatible
// with the legacy DATE_PATTERN_RE / SLOT_PATTERN_RE so all existing
// numeric/JA behavior is preserved.
//   group 1: year (optional)  2: month  3: day
//   group 4: hour (optional)  5: minute (optional)
const NUMERIC_DATE_RE = new RegExp(
  "(?:(\\d{4})[年/-])?(\\d{1,2})[月/-](\\d{1,2})日?(?:\\s*\\([月火水木金土日]\\))?" +
    "(?:\\s*[にで]?\\s*(\\d{1,2}):(\\d{2}))?",
  "g",
);

// English long-form date: optional leading weekday ("Thursday, "),
// month name, day, optional ", YYYY". Optionally followed by a clock
// time (12h or 24h) and/or a time range.
//   group 1: month name   2: day   3: year (optional)
//   group 4: start-time block (raw, parsed separately)
//   group 5: end-time block (raw, range; parsed separately)
const TIME_TOKEN = "\\d{1,2}(?::(\\d{2}))?\\s*(?:[AaPp]\\.?[Mm]\\.?)?";
const ENGLISH_DATE_RE = new RegExp(
  "(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?,?\\s+)?" +
    `(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?` +
    // Optional time / range after the date. The "at"/"@"/comma glue is
    // tolerated. Start time, then an optional "- endtime" for ranges.
    `(?:[\\s,]*(?:at\\s+|@\\s*)?(${TIME_TOKEN}))?` +
    `(?:\\s*[-–—]\\s*(${TIME_TOKEN}))?`,
  "gi",
);

// Standalone clock time anywhere (12h or 24h), used when a date and a
// time are on different lines (common in "Date:" / "Time:" blocks). We
// only consume this from extractTimeNear, never as a date anchor.
const STANDALONE_TIME_RE = new RegExp(
  `(?<![\\d:])(${TIME_TOKEN})(?:\\s*[-–—]\\s*(${TIME_TOKEN}))?`,
  "gi",
);

// ---------- time parsing ----------

type ParsedTime = { hour: number; minute: number } | null;

// Parse a single clock token to 24h. Handles "4", "4:30", "4 PM",
// "4:00pm", "16:00", "12 AM", "12 PM". Returns null on out-of-range.
export function parseClockToken(token: string): ParsedTime {
  const m = token
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?\s*$|^(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;

  // Branch A — 12h with AM/PM (groups 1-3). Branch B — bare 24h HH:MM
  // (groups 4-5). We keep them separate so a bare "4" with no meridiem
  // and no minutes is NOT treated as a time (too ambiguous → no match).
  if (m[1] !== undefined && m[3] !== undefined) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    const isPm = m[3].toLowerCase() === "p";
    if (hour < 1 || hour > 12 || minute > 59) return null;
    // 12 AM → 00, 12 PM → 12, else +12 for PM.
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
    return { hour, minute };
  }

  if (m[4] !== undefined && m[5] !== undefined) {
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

function minutesBetween(start: ParsedTime, end: ParsedTime): number | undefined {
  if (!start || !end) return undefined;
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  const diff = e - s;
  return diff > 0 ? diff : undefined;
}

// ---------- exported extraction ----------

// Sweep the body for ALL date mentions (numeric/JA + English long-form),
// returning positional matches in source order. `referenceYear` fills
// in the year when the date text omits it.
export function extractDateTimeMatches(
  body: string,
  referenceYear: number,
): DateTimeMatch[] {
  if (!body) return [];
  const out: DateTimeMatch[] = [];

  // --- numeric / JA ---
  NUMERIC_DATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMERIC_DATE_RE.exec(body)) !== null) {
    if (m[0].length === 0) {
      NUMERIC_DATE_RE.lastIndex++;
      continue;
    }
    const year = m[1] ? parseInt(m[1], 10) : referenceYear;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!validYmd(year, month, day)) continue;

    const match: DateTimeMatch = {
      year,
      month,
      day,
      index: m.index,
      length: m[0].length,
      raw: m[0],
    };
    if (m[4] !== undefined && m[5] !== undefined) {
      const hour = parseInt(m[4], 10);
      const minute = parseInt(m[5], 10);
      if (hour <= 23 && minute <= 59) {
        match.hour = hour;
        match.minute = minute;
      }
    }
    out.push(match);
  }

  // --- English long-form ---
  ENGLISH_DATE_RE.lastIndex = 0;
  while ((m = ENGLISH_DATE_RE.exec(body)) !== null) {
    if (m[0].length === 0) {
      ENGLISH_DATE_RE.lastIndex++;
      continue;
    }
    const month = MONTH_NAME_TO_NUM[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : referenceYear;
    if (month === undefined || !validYmd(year, month, day)) continue;

    const match: DateTimeMatch = {
      year,
      month,
      day,
      index: m.index,
      length: m[0].length,
      raw: m[0],
    };

    // m[4] = start-time token, m[6] = end-time token (m[5]/m[7] are the
    // inner minute capture groups of TIME_TOKEN). Trim the matched span
    // back to the date when the trailing time token doesn't parse, so a
    // stray "- something" doesn't swallow unrelated text.
    const startTok = m[4];
    const endTok = m[6];
    const start = startTok ? parseClockToken(startTok) : null;
    if (start) {
      match.hour = start.hour;
      match.minute = start.minute;
      const end = endTok ? parseClockToken(endTok) : null;
      const dur = minutesBetween(start, end);
      if (dur !== undefined) match.durationMin = dur;
    } else if (startTok) {
      // Time token present in the regex span but unparseable — shrink
      // the reported span to just the date portion (everything up to
      // the start-time token) so callers' proximity math stays tight.
      const trimmed = m[0].slice(0, m[0].indexOf(startTok)).trimEnd();
      if (trimmed.length > 0) {
        match.length = trimmed.length;
        match.raw = trimmed;
      }
    }
    out.push(match);
  }

  // Source-order so callers iterating for "first match" behave like the
  // legacy single-regex sweep did.
  out.sort((a, b) => a.index - b.index);
  return out;
}

// Find a clock time within a window of text (used when "Date:" and
// "Time:" are on separate lines). Returns the first parseable time +
// optional range duration. Pure scan, no date component.
export function extractTimeNear(
  text: string,
): { hour: number; minute: number; durationMin?: number } | null {
  STANDALONE_TIME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STANDALONE_TIME_RE.exec(text)) !== null) {
    if (m[0].length === 0) {
      STANDALONE_TIME_RE.lastIndex++;
      continue;
    }
    const start = parseClockToken(m[1]);
    if (!start) continue;
    const end = m[3] ? parseClockToken(m[3]) : null;
    const dur = minutesBetween(start, end);
    return dur !== undefined
      ? { hour: start.hour, minute: start.minute, durationMin: dur }
      : { hour: start.hour, minute: start.minute };
  }
  return null;
}

// ---------- helpers ----------

function validYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 3000) return false;
  return true;
}

// Format a match's date as YYYY-MM-DD (zero-padded).
export function isoDateOf(match: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${match.year.toString().padStart(4, "0")}-${match.month
    .toString()
    .padStart(2, "0")}-${match.day.toString().padStart(2, "0")}`;
}

// Format an hour/minute pair as 24h HH:MM.
export function isoTimeOf(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}
