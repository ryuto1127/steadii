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
// We deliberately drop master rules — the consumer wants concrete instances
// only, same as Google's `singleEvents: true` expansion. Recurrence
// expansion is best-effort: node-ical surfaces children via the parent's
// `recurrences` map but doesn't expand RRULE forward in time on its own.
// For α we treat the master DTSTART as the canonical instance and pull
// any explicit overrides from `recurrences`. This covers fixed-schedule
// course timetables (the dominant α use case); proper RRULE expansion
// is a post-α follow-up.
export function parseIcal(
  icsBody: string,
  options: { windowStart: Date; windowEnd: Date }
): ParsedIcalEvent[] {
  const parsed = nodeIcal.parseICS(icsBody);
  const out: ParsedIcalEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const comp = parsed[key] as RawIcalComponent & {
      recurrences?: Record<string, RawIcalComponent>;
    };
    if (comp?.type !== "VEVENT") continue;

    const collect = (instance: RawIcalComponent, recurrenceId: string | null) => {
      const start = toDate(instance.start);
      if (!start) return;
      if (start < options.windowStart || start >= options.windowEnd) return;

      const end = toDate(instance.end);
      const isAllDay = instance.datetype === "date";

      out.push({
        uid: comp.uid ?? key,
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

    // Per-instance overrides (e.g. a moved class on a single date).
    if (comp.recurrences) {
      for (const recurKey of Object.keys(comp.recurrences)) {
        collect(comp.recurrences[recurKey], recurKey);
      }
    }
  }

  return out;
}
