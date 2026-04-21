export type CalendarView = "month" | "week" | "day";

export type PendingCreate = {
  dayIso: string;
  startSlot: number;
  endSlot: number;
} | null;

export type CalendarEvent = {
  kind: "event";
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
  recurringEventId?: string | null;
  reminders?: { minutes: number } | null;
};

export type CalendarTask = {
  kind: "task";
  id: string;
  title: string;
  due: string; // YYYY-MM-DD, local-date-only
  notes: string | null;
  completed: boolean;
  taskListId: string;
  parentId: string | null;
};

export type CalendarItem = CalendarEvent | CalendarTask;

const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic labels — avoid Intl/toLocale* in the render tree (Node ICU vs
// browser Intl diverge, e.g. "1 AM" vs "1 a.m.", and cause hydration mismatches).
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatTime12(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h < 12 ? "AM" : "PM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatHour12(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12} ${period}`;
}

export function isAllDayString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const dow = out.getDay();
  out.setDate(out.getDate() - dow);
  return out;
}

export function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

export function visibleRange(view: CalendarView, anchor: Date): {
  start: Date;
  end: Date;
} {
  if (view === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const start = startOfMonthGrid(anchor);
  return { start, end: addDays(start, 42) };
}

export function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateTimeLocalInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function localDateTimeToRfc3339(local: string): string {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return rfc3339Local(dt);
}

export function rfc3339Local(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const offH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0");
  const offM = String(Math.abs(offsetMin) % 60).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mi}:${ss}${sign}${offH}:${offM}`;
}

export function parseEventStart(e: { start: string; allDay: boolean }): Date {
  if (e.allDay) {
    const [y, m, d] = e.start.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(e.start);
}

export function parseEventEnd(e: { end: string; allDay: boolean }): Date {
  if (e.allDay) {
    const [y, m, d] = e.end.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(e.end);
}

export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const ds = startOfDay(day).getTime();
  const de = ds + DAY_MS;
  return events.filter((e) => {
    const s = parseEventStart(e).getTime();
    const en = parseEventEnd(e).getTime();
    return s < de && en > ds;
  });
}

export function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function snapToSlot(minutes: number, slotMinutes = 30): number {
  return Math.round(minutes / slotMinutes) * slotMinutes;
}

// Column layout for overlapping timed events within one day.
// Returns, per event, { col, cols } so UI can render width=1/cols at left=col/cols.
export type EventSlot = { eventId: string; col: number; cols: number };

export function layoutDayColumns(timed: CalendarEvent[]): EventSlot[] {
  const sorted = [...timed].sort((a, b) => {
    const as = parseEventStart(a).getTime();
    const bs = parseEventStart(b).getTime();
    if (as !== bs) return as - bs;
    const ae = parseEventEnd(a).getTime();
    const be = parseEventEnd(b).getTime();
    return be - ae;
  });
  const result = new Map<string, { col: number; cluster: number }>();
  type Live = { id: string; col: number; endMs: number };
  let live: Live[] = [];
  let cluster: Array<Live> = [];
  let clusterId = 0;
  const clusterMax = new Map<number, number>();

  const flushCluster = () => {
    if (cluster.length === 0) return;
    let maxCol = 0;
    for (const c of cluster) {
      if (c.col > maxCol) maxCol = c.col;
    }
    clusterMax.set(clusterId, maxCol + 1);
    clusterId += 1;
    cluster = [];
  };

  for (const ev of sorted) {
    const s = parseEventStart(ev).getTime();
    const e = parseEventEnd(ev).getTime();
    live = live.filter((l) => l.endMs > s);
    if (live.length === 0) flushCluster();
    const used = new Set(live.map((l) => l.col));
    let col = 0;
    while (used.has(col)) col += 1;
    const live1: Live = { id: ev.id, col, endMs: e };
    live.push(live1);
    cluster.push(live1);
    result.set(ev.id, { col, cluster: clusterId });
  }
  flushCluster();

  return sorted.map((ev) => {
    const r = result.get(ev.id);
    if (!r) return { eventId: ev.id, col: 0, cols: 1 };
    const cols = clusterMax.get(r.cluster) ?? 1;
    return { eventId: ev.id, col: r.col, cols };
  });
}

// ---------------- RRULE ----------------
export type RecurrenceKind =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekly" }
  | { kind: "monthly" }
  | {
      kind: "custom";
      byDay: Weekday[];
      end:
        | { kind: "never" }
        | { kind: "until"; date: string }
        | { kind: "count"; count: number };
    }
  | { kind: "advanced"; raw: string[] };

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function parseRecurrence(rules: string[] | null | undefined): RecurrenceKind {
  if (!rules || rules.length === 0) return { kind: "none" };
  if (rules.length > 1) return { kind: "advanced", raw: rules };
  const raw = rules[0];
  if (!raw.startsWith("RRULE:")) return { kind: "advanced", raw: rules };
  const body = raw.slice("RRULE:".length);
  const parts = new Map<string, string>();
  for (const piece of body.split(";")) {
    const [k, v] = piece.split("=");
    if (!k || !v) return { kind: "advanced", raw: rules };
    parts.set(k.toUpperCase(), v);
  }
  const freq = parts.get("FREQ");
  const keys = [...parts.keys()].sort().join(",");

  if (keys === "FREQ") {
    if (freq === "DAILY") return { kind: "daily" };
    if (freq === "WEEKLY") return { kind: "weekly" };
    if (freq === "MONTHLY") return { kind: "monthly" };
  }

  if (freq === "WEEKLY") {
    const allowed = new Set(["FREQ", "BYDAY", "UNTIL", "COUNT"]);
    const extra = [...parts.keys()].filter((k) => !allowed.has(k));
    if (extra.length === 0) {
      const byDayRaw = parts.get("BYDAY");
      const byDay: Weekday[] = byDayRaw
        ? byDayRaw.split(",").filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday))
        : [];
      const until = parts.get("UNTIL");
      const count = parts.get("COUNT");
      let end: Extract<RecurrenceKind, { kind: "custom" }>["end"];
      if (until) {
        const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
        end = { kind: "until", date };
      } else if (count) {
        const n = Number.parseInt(count, 10);
        if (!Number.isFinite(n) || n < 1) return { kind: "advanced", raw: rules };
        end = { kind: "count", count: n };
      } else {
        end = { kind: "never" };
      }
      return { kind: "custom", byDay, end };
    }
  }

  return { kind: "advanced", raw: rules };
}

export function formatRecurrence(r: RecurrenceKind): string[] {
  if (r.kind === "none") return [];
  if (r.kind === "daily") return ["RRULE:FREQ=DAILY"];
  if (r.kind === "weekly") return ["RRULE:FREQ=WEEKLY"];
  if (r.kind === "monthly") return ["RRULE:FREQ=MONTHLY"];
  if (r.kind === "advanced") return r.raw;
  // custom
  const parts: string[] = ["FREQ=WEEKLY"];
  if (r.byDay.length > 0) {
    const ordered = WEEKDAYS.filter((w) => r.byDay.includes(w));
    parts.push(`BYDAY=${ordered.join(",")}`);
  }
  if (r.end.kind === "until") {
    const [y, m, d] = r.end.date.split("-");
    parts.push(`UNTIL=${y}${m}${d}T000000Z`);
  } else if (r.end.kind === "count") {
    parts.push(`COUNT=${r.end.count}`);
  }
  return [`RRULE:${parts.join(";")}`];
}
