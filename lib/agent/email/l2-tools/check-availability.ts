import "server-only";
import { listEventsInRange } from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import type { L2ToolExecutor } from "./types";

// engineer-41 — given a list of candidate slots and the user's timezone,
// return per-slot availability against the canonical events store.
//
// The agentic loop calls extract_candidate_dates first, then converts
// each candidate to an ISO instant (using the senderTimezone hint if
// present, else the user's own), then asks this tool whether each slot
// is free. The tool also returns dual-timezone display strings the loop
// can paste into the draft body — "5/15 10:00 JST = 5/14 18:00 PT".

export type AvailabilitySlot = {
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
};

export type CheckAvailabilityArgs = {
  slots: AvailabilitySlot[];
  // Optional override; defaults to users.timezone or FALLBACK_TZ.
  userTimezone?: string | null;
  // The other side's timezone for display. When null, the dual-timezone
  // string only shows the user-side.
  displayTimezone?: string | null;
};

export type AvailabilityCheck = {
  slot: AvailabilitySlot;
  isAvailable: boolean;
  conflictingEvents: Array<{ title: string; start: string; end: string }>;
  // Pre-formatted "user side" + "sender side" strings the LLM can
  // splice directly into the draft body without re-doing TZ math.
  displayTimes: {
    user: string;
    sender: string | null;
  };
};

export type CheckAvailabilityResult = {
  results: AvailabilityCheck[];
};

export const checkAvailabilityTool: L2ToolExecutor<
  CheckAvailabilityArgs,
  CheckAvailabilityResult
> = {
  schema: {
    name: "check_availability",
    description:
      "For each {start, end} slot, return whether the user is free (against Google Calendar + Microsoft Graph in the canonical events store) AND a pre-formatted dual-timezone display string. Pass `displayTimezone` (the sender's IANA) so the result includes 'sender-side' clock strings the draft phase can use verbatim. Slots are ISO 8601 UTC.",
    parameters: {
      type: "object",
      properties: {
        slots: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              start: { type: "string", minLength: 16 },
              end: { type: "string", minLength: 16 },
            },
            required: ["start", "end"],
          },
        },
        userTimezone: { type: ["string", "null"] },
        displayTimezone: { type: ["string", "null"] },
      },
      required: ["slots"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const userTz =
      args.userTimezone?.trim() ||
      (await getUserTimezone(ctx.userId)) ||
      FALLBACK_TZ;
    const senderTz = args.displayTimezone?.trim() || null;

    // Compute the inclusive window that covers every slot so a single
    // events query is enough. Pad ±1d so events that straddle a slot
    // boundary still surface.
    if (args.slots.length === 0) return { results: [] };
    const startsMs = args.slots.map((s) => Date.parse(s.start));
    const endsMs = args.slots.map((s) => Date.parse(s.end));
    const fromISO = new Date(
      Math.min(...startsMs) - 24 * 60 * 60 * 1000
    ).toISOString();
    const toISO = new Date(
      Math.max(...endsMs) + 24 * 60 * 60 * 1000
    ).toISOString();

    const events = await listEventsInRange(ctx.userId, fromISO, toISO, {
      kinds: ["event"],
    });

    const results: AvailabilityCheck[] = args.slots.map((slot) => {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      const conflicts = events
        .filter((e) => {
          const evStart = new Date(e.startsAt);
          const evEnd = e.endsAt ? new Date(e.endsAt) : evStart;
          // Overlap iff slotStart < evEnd AND evStart < slotEnd.
          return slotStart < evEnd && evStart < slotEnd;
        })
        .map((e) => ({
          title: e.title ?? "(untitled)",
          start: new Date(e.startsAt).toISOString(),
          end: (e.endsAt ? new Date(e.endsAt) : new Date(e.startsAt)).toISOString(),
        }));
      return {
        slot,
        isAvailable: conflicts.length === 0,
        conflictingEvents: conflicts,
        displayTimes: {
          user: formatInTimezone(slotStart, slotEnd, userTz),
          sender: senderTz
            ? formatInTimezone(slotStart, slotEnd, senderTz)
            : null,
        },
      };
    });

    return { results };
  },
};

// "5/15 (Fri) 10:00–11:00 Asia/Tokyo" — locale-friendly, IANA-tagged so
// the LLM can splice it without re-doing TZ math.
export function formatInTimezone(start: Date, end: Date, tz: string): string {
  try {
    const fmtDate = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    const fmtTime = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${fmtDate.format(start)} ${fmtTime.format(start)}–${fmtTime.format(end)} ${tz}`;
  } catch {
    return `${start.toISOString()}–${end.toISOString()} (${tz})`;
  }
}
