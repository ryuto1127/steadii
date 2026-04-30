import "server-only";
import nodeIcal from "node-ical";

// Flat shape produced by parsing one .ics document. The sync module maps
// these into NewEventRow inserts; downstream consumers (fanout, the events
// mirror queries) never see the raw VEVENT.
export type ParsedIcalEvent = {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled" | null;
  recurrenceId: string | null;
};

// node-ical's VEVENT shape is loosely typed (and inherits from BaseComponent
// for VTIMEZONE/VTODO entries we don't care about). This narrows to the
// VEVENT subset we actually pull out.
type RawIcalComponent = {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  start?: Date | string;
  end?: Date | string;
  datetype?: "date" | "date-time";
  status?: string;
  recurrenceid?: Date | string;
};

// node-ical exposes recurrence rules through a wrapper compatible with the
// rrule.js v2 API (between/all/before/after). We only need `between`.
type RRuleWrapper = {
  between: (after: Date, before: Date, inclusive?: boolean) => Date[];
};

function toDate(value: Date | string | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normaliseStatus(
  raw: string | undefined
): ParsedIcalEvent["status"] {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "confirmed" || lower === "tentative" || lower === "cancelled")
    return lower;
  return null;
}

// Parse an .ics document into a flat list of VEVENTs filtered to a window.
// Recurring events (RRULE) are expanded into one row per occurrence within
// the window — this is what makes a typical course-schedule feed (master
// DTSTART weeks in the past, weekly recurrence forward into the term)
// surface any rows at all. Per-instance overrides from `recurrences` win
// over the master fields for matching dates. EXDATEs are honored by the
// underlying rrule wrapper.
export function parseIcal(
  icsBody: string,
  options: { windowStart: Date; windowEnd: Date }
): ParsedIcalEvent[] {
  const parsed = nodeIcal.parseICS(icsBody);
  const out: ParsedIcalEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const comp = parsed[key] as RawIcalComponent & {
      recurrences?: Record<string, RawIcalComponent>;
      rrule?: RRuleWrapper;
    };
    if (comp?.type !== "VEVENT") continue;

    const masterStart = toDate(comp.start);
    const masterEnd = toDate(comp.end);
    const masterDuration =
      masterStart && masterEnd
        ? masterEnd.getTime() - masterStart.getTime()
        : null;
    const masterIsAllDay = comp.datetype === "date";
    const masterTitle = comp.summary?.toString().trim() || "(untitled)";
    const masterDesc = comp.description?.toString().trim() || null;
    const masterLoc = comp.location?.toString().trim() || null;
    const masterUrl = comp.url?.toString().trim() || null;
    const masterStatus = normaliseStatus(comp.status);
    const uid = comp.uid ?? key;

    if (comp.rrule && masterStart) {
      // Recurring event — expand within the window. node-ical/rrule-temporal
      // honors EXDATE by default. Per-instance overrides in
      // `comp.recurrences` win for matching dates (a moved class on one
      // specific week, etc.).
      let occurrences: Date[];
      try {
        occurrences = comp.rrule.between(
          options.windowStart,
          options.windowEnd,
          true
        );
      } catch {
        // Some malformed RRULEs blow up rrule-temporal — fall through to
        // emitting the master at its own DTSTART (best-effort).
        occurrences = [];
      }
      const seenInstanceKeys = new Set<string>();
      for (const occ of occurrences) {
        const isoKey = occ.toISOString();
        const dateKey = isoKey.slice(0, 10);
        // node-ical stores each override at TWO keys (dateKey and isoKey)
        // pointing to the same object. Track which keys we've emitted so
        // a later non-rrule branch (or repeated instance) can't double-add.
        if (seenInstanceKeys.has(isoKey)) continue;
        seenInstanceKeys.add(isoKey);
        const override =
          comp.recurrences?.[isoKey] || comp.recurrences?.[dateKey] || null;
        if (override) {
          const ovrStart = toDate(override.start) ?? occ;
          const ovrEnd = toDate(override.end);
          out.push({
            uid,
            title: override.summary?.toString().trim() || masterTitle,
            description:
              override.description?.toString().trim() || masterDesc,
            location: override.location?.toString().trim() || masterLoc,
            url: override.url?.toString().trim() || masterUrl,
            startsAt: ovrStart,
            endsAt:
              ovrEnd ??
              (masterDuration
                ? new Date(ovrStart.getTime() + masterDuration)
                : null),
            isAllDay: override.datetype === "date" || masterIsAllDay,
            status: normaliseStatus(override.status) ?? masterStatus,
            recurrenceId: isoKey,
          });
        } else {
          out.push({
            uid,
            title: masterTitle,
            description: masterDesc,
            location: masterLoc,
            url: masterUrl,
            startsAt: occ,
            endsAt: masterDuration
              ? new Date(occ.getTime() + masterDuration)
              : null,
            isAllDay: masterIsAllDay,
            status: masterStatus,
            recurrenceId: isoKey,
          });
        }
      }
      continue;
    }

    // Non-recurring (or no rrule wrapper available) — emit the master at
    // its own DTSTART, then any per-instance overrides. Dedup overrides by
    // identity since node-ical stores each at both dateKey and isoKey.
    const collect = (
      instance: RawIcalComponent,
      recurrenceId: string | null
    ) => {
      const start = toDate(instance.start);
      if (!start) return;
      if (start < options.windowStart || start >= options.windowEnd) return;
      const end = toDate(instance.end);
      const isAllDay = instance.datetype === "date";
      out.push({
        uid,
        title: instance.summary?.toString().trim() || "(untitled)",
        description: instance.description?.toString().trim() || null,
        location: instance.location?.toString().trim() || null,
        url: instance.url?.toString().trim() || null,
        startsAt: start,
        endsAt: end,
        isAllDay,
        status: normaliseStatus(instance.status),
        recurrenceId,
      });
    };

    collect(comp, null);

    if (comp.recurrences) {
      const seen = new Set<RawIcalComponent>();
      for (const recurKey of Object.keys(comp.recurrences)) {
        const inst = comp.recurrences[recurKey];
        if (seen.has(inst)) continue;
        seen.add(inst);
        collect(inst, recurKey);
      }
    }
  }

  return out;
}
