// Pure helpers for D10 syllabus → calendar matching. Lives in its own
// file (no server-only / db imports) so tests can exercise it.

export const FUZZY_TIME_WINDOW_HOURS = 1;

export type ExtractedSyllabusEventMin = {
  classCode: string | null;
  className: string;
  startsAt: Date;
  label: string;
};

export type CalendarRowMin = {
  id: string;
  externalId: string;
  title: string;
  startsAt: Date;
};

export type MatchOutcome =
  | {
      kind: "confident_match";
      candidate: { id: string; externalId: string };
    }
  | { kind: "confident_no_match" }
  | { kind: "ambiguous"; candidate: { id: string; title: string } };

export function matchToCalendar(
  evt: ExtractedSyllabusEventMin,
  inWindow: CalendarRowMin[]
): MatchOutcome {
  const fuzzy = FUZZY_TIME_WINDOW_HOURS * 3600 * 1000;
  const sameTime = inWindow.filter(
    (r) => Math.abs(r.startsAt.getTime() - evt.startsAt.getTime()) <= fuzzy
  );

  for (const r of sameTime) {
    const titleLower = r.title.toLowerCase();
    const codeMatch =
      evt.classCode &&
      titleLower.includes(evt.classCode.toLowerCase());
    const nameMatch =
      titleLower.includes(evt.className.toLowerCase()) ||
      titleLower.includes(evt.label.toLowerCase());
    if (codeMatch || nameMatch) {
      return {
        kind: "confident_match",
        candidate: { id: r.id, externalId: r.externalId },
      };
    }
  }

  if (sameTime.length > 0) {
    return {
      kind: "ambiguous",
      candidate: { id: sameTime[0].id, title: sameTime[0].title },
    };
  }
  const titleMatch = inWindow.find(
    (r) =>
      (evt.classCode &&
        r.title.toLowerCase().includes(evt.classCode.toLowerCase())) ||
      r.title.toLowerCase().includes(evt.label.toLowerCase())
  );
  if (titleMatch) {
    return {
      kind: "ambiguous",
      candidate: { id: titleMatch.id, title: titleMatch.title },
    };
  }
  return { kind: "confident_no_match" };
}

const MONTHS_EN: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function parseSimpleDate(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare YYYY-MM-DD parses as UTC midnight, which lands a day early in
  // negative-offset timezones. Default to 9 AM local so the calendar event
  // sits on the intended day.
  const isoBare = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoBare) {
    const [, y, m, d] = isoBare;
    return new Date(Number(y), Number(m) - 1, Number(d), 9, 0);
  }

  // Try the English month-day allowlist before `new Date()` — V8 parses
  // bare "Jan 13" as midnight of the current year, which is right by date
  // but wrong by time-of-day. The regex defaults missing times to 9 AM.
  const en = matchEnglishMonthDay(trimmed);
  if (en) return en;

  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;

  const slash = trimmed.match(
    /^(\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (slash) {
    const year = new Date().getFullYear();
    const [, m, d, hh, mm] = slash;
    return new Date(
      year,
      Number(m) - 1,
      Number(d),
      hh ? Number(hh) : 9,
      mm ? Number(mm) : 0
    );
  }
  const jp = trimmed.match(
    /^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (jp) {
    const year = new Date().getFullYear();
    const [, m, d, hh, mm] = jp;
    return new Date(
      year,
      Number(m) - 1,
      Number(d),
      hh ? Number(hh) : 9,
      mm ? Number(mm) : 0
    );
  }

  return null;
}

// Scans for the first English `<Month> <day>` pair anywhere in the string,
// optionally followed by a year and a time. Catches "Jan 13", "January 13,
// 2026", "Mon Jan 13", and "Week 1: Jan 8" — the new Date() fallback above
// handles a subset of these but is implementation-dependent across Node
// versions, so we do an explicit allowlist here. "TBD" / "Week N" / "第1週"
// don't match and correctly return null.
function matchEnglishMonthDay(input: string): Date | null {
  const re =
    /\b([A-Za-z]+)\s+(\d{1,2})\b(?:[,\s]+(\d{4}))?(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2}))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const [, mStr, dStr, yStr, hh, mm] = match;
    const monthIdx = MONTHS_EN[mStr.toLowerCase()];
    if (monthIdx === undefined) continue;
    const day = Number(dStr);
    if (day < 1 || day > 31) continue;
    const year = yStr ? Number(yStr) : new Date().getFullYear();
    return new Date(
      year,
      monthIdx,
      day,
      hh ? Number(hh) : 9,
      mm ? Number(mm) : 0
    );
  }
  return null;
}
