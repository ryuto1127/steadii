import "server-only";

// 2026-05-24 — Shared slot-formatting helpers for auto-cal.
// Extracted from auto-calendar-create.ts when the orchestrator went
// propose-only: the wall-clock → RFC3339 conversion + summary /
// description builders are still needed by the queue Add action and
// the queue card builder, just not by the detector path anymore.

import type {
  AutoCreatedAgreedSlot,
  AutoCreatedCalendarEventRow,
} from "@/lib/db/schema";
import { convertTimezoneSync } from "@/lib/agent/tools/convert-timezone";
import type { EmailSnapshot } from "./mutual-agreement-detector";

// 2026-06-07 — Single source of truth for "is this auto-cal proposal past
// its useful date". Used by BOTH the queue display filter
// (fetchPendingAutoCalRows drops stale rows before rendering) AND the
// expiry sweep (cancel date-stale rows immediately, rather than letting
// them linger the full 7d grace). Pure: no DB / LLM / I/O.
//
// The auto-cal path previously had NO date comparison — a deadline due on
// the 5th still surfaced on the 7th and lived until the 12d grace expiry.
// The assignment-reminder path already drops past-due items (`deltaMs < 0`
// in rules/assignment-deadline-reminder.ts); this brings the auto-cal
// path to parity.
export function isAutoCalProposalStale(
  args: {
    kind: AutoCreatedCalendarEventRow["kind"];
    agreedSlot: AutoCreatedAgreedSlot;
  },
  nowMs: number,
): boolean {
  const { kind, agreedSlot } = args;

  if (kind === "deadline") {
    // All-day, date-only: stale once the deadline's calendar DAY (in its
    // own timezone) has fully passed. A deadline due TODAY in its tz stays
    // visible all day; due yesterday → stale. Compare YYYY-MM-DD strings
    // lexicographically (en-CA ordering sorts correctly): the proposal is
    // stale when its date is strictly before today's date in its tz.
    const todayInTz = isoDateInTz(new Date(nowMs), agreedSlot.timezone);
    return agreedSlot.date < todayInTz;
  }

  // Timed (event / mutual_agreement): stale when the event END instant is
  // before now. In-progress events (start ≤ now < end) still surface.
  const { endIso } = buildIsoStartEnd(agreedSlot);
  return Date.parse(endIso) < nowMs;
}

// YYYY-MM-DD for `d` rendered in `tz`. en-CA gives the YYYY-MM-DD ordering
// that sorts lexicographically. Mirrors the same helper in event-detector
// (kept local here to keep this module's server-only deps self-contained).
function isoDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

// Build RFC3339 start + end strings (with TZ offset) from the agreed
// wall-clock slot. Both reuse convertTimezoneSync's wall-clock → ISO
// path so we inherit its DST-aware offset resolution.
export function buildIsoStartEnd(slot: AutoCreatedAgreedSlot): {
  startIso: string;
  endIso: string;
} {
  const startWall = `${slot.date}T${slot.startTime}`;
  const startConverted = convertTimezoneSync({
    time: startWall,
    fromTz: slot.timezone,
    toTz: slot.timezone,
    locale: "en",
  });

  // End = start + durationMin. Anchor against the start's UTC instant
  // and add minutes, then reformat the end wall-clock for the slot
  // timezone with the correct offset.
  const startUtcMs = Date.parse(startConverted.toIso);
  const endUtcMs = startUtcMs + slot.durationMin * 60 * 1000;
  const endDate = new Date(endUtcMs);
  const endIso = formatInstantWithTzOffset(endDate, slot.timezone);

  return { startIso: startConverted.toIso, endIso };
}

function formatInstantWithTzOffset(d: Date, tz: string): string {
  // Use Intl to get the wall-clock components in tz, then round-trip
  // through convertTimezoneSync to attach the correct offset.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const wall = `${map.year}-${map.month}-${map.day}T${map.hour.replace(
    /^24/,
    "00",
  )}:${map.minute}:${map.second}`;
  return convertTimezoneSync({
    time: wall,
    fromTz: tz,
    toTz: tz,
    locale: "en",
  }).toIso;
}

// Inbound subject (Re:/Fwd: stripped) becomes the event title in the
// propose-confirm Add path. The Round-3 flow no longer prefixes with
// [Steadii] — the event only lands on the user's calendar after they
// click Add, so the agent-authorship signal is captured by user intent.
export function buildSummaryFromThread(thread: EmailSnapshot[]): string {
  const lastInbound = [...thread]
    .reverse()
    .find((m) => m.direction === "inbound");
  const subj = (lastInbound?.subject ?? "").replace(
    /^(\s*(re|fwd|fw)\s*[:：]\s*)+/gi,
    "",
  );
  return subj.length > 0 ? subj : "Meeting";
}

export function buildMutualAgreementDescription(
  reasoning: string,
  slot: AutoCreatedAgreedSlot,
): string {
  return [
    "Added to your calendar from a detected mutual scheduling agreement in your email thread.",
    "",
    `Agreed slot: ${slot.date} ${slot.startTime} ${slot.timezone} (${slot.durationMin} min).`,
    "",
    "Detector reasoning:",
    reasoning,
  ].join("\n");
}

export function buildDeadlineSummary(topic: string): string {
  return `${topic} (締切)`;
}

// 2026-05-27 — scheduled-event (kind='event') title + description for
// the Type G' Add path. Unlike deadline these are TIMED events, so the
// description carries the start time + duration.
export function buildEventSummary(topic: string): string {
  return topic;
}

export function buildEventDescription(args: {
  reasoning: string;
  date: string;
  startTime: string;
  timezone: string;
  durationMin: number;
  topic: string;
}): string {
  return [
    "Added to your calendar from a scheduled event detected in your email.",
    "",
    `When: ${args.date} ${args.startTime} ${args.timezone} (${args.durationMin} min).`,
    `Topic: ${args.topic}`,
    "",
    "Detector reasoning:",
    args.reasoning,
  ].join("\n");
}

export function buildDeadlineDescription(args: {
  reasoning: string;
  date: string;
  timezone: string;
  topic: string;
}): string {
  return [
    "Added to your calendar from a deadline detected in your email.",
    "",
    `Deadline: ${args.date} (${args.timezone}).`,
    `Topic: ${args.topic}`,
    "",
    "Detector reasoning:",
    args.reasoning,
  ].join("\n");
}
