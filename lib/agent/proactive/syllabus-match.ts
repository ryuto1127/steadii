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

export function parseSimpleDate(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
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
