import "server-only";

// 2026-05-21 — Phase 2 of α-auto-cal. Orchestrates the chain:
//
//   thread input
//     → detectMutualAgreement(...)
//     → calendarCreateEvent({ summary: "[Steadii] ..." })
//     → INSERT into auto_created_calendar_events (status: provisional)
//
// Conservative bias inherited from the detector (Phase 1):
//   - Confidence ≥ 0.80 is required for auto-create
//   - User must be opted in (preferences.autoCalendarCreate !== false)
//   - Idempotency: one non-cancelled row per (user, inbox_item)
//
// Phase 3 reads the auto_created_calendar_events row to render the
// cancel UI in /app/queue; Phase 4 cron promotes the event to
// 'confirmed' after the 24h grace window (dropping the [Steadii]
// prefix from the calendar event title).
//
// The calendarCreateEvent dependency is INJECTED so unit tests can
// run without spinning up Google Calendar. Production callers use the
// default-injected `calendarCreateEvent` tool executor.

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  users,
  type AutoCreatedAgreedSlot,
  type AutoCreatedEventRef,
} from "@/lib/db/schema";
import { calendarCreateEvent } from "@/lib/agent/tools/calendar";
import { convertTimezoneSync } from "@/lib/agent/tools/convert-timezone";
import {
  detectMutualAgreement,
  type EmailSnapshot,
} from "./mutual-agreement-detector";

export type AutoCreateOptions = {
  // Threshold for `confirmed: true` to fire the create. Defaults to 0.80.
  threshold?: number;
  // Grace window in minutes. Defaults to 1440 (24h).
  graceWindowMinutes?: number;
  // For tests / dry runs: when true, skip the actual calendar API call
  // AND skip the DB write. Returns what would have happened.
  dryRun?: boolean;
  // Injectable calendar create function. Defaults to the production tool.
  // Tests pass a mock; production callers omit.
  calendarCreate?: CalendarCreateFn;
  // Override `now()` for deterministic tests.
  nowMs?: number;
};

// Pluggable shape matches the relevant fields of calendarCreateEvent's
// result so consumers don't depend on the full tool result type.
export type CalendarCreateFn = (args: {
  userId: string;
  summary: string;
  start: string;
  end: string;
  description: string;
}) => Promise<{
  eventId: string;
  htmlLink: string | null;
  createdIn: Array<"google_calendar" | "microsoft_graph">;
}>;

export type AutoCreateResult =
  | { action: "skipped"; reason: string; confidence: number }
  | {
      action: "created";
      autoCreateId: string;
      confidence: number;
      eventRefs: AutoCreatedEventRef[];
      agreedSlot: AutoCreatedAgreedSlot;
      graceExpiresAt: Date;
    };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_GRACE_MINUTES = 24 * 60;

export async function evaluateAndCreateIfAgreed(args: {
  userId: string;
  inboxItemId: string;
  thread: EmailSnapshot[];
  userTimezone: string;
  // Sender's TZ (typically from infer_sender_timezone). Used as the
  // default when slot text in the thread doesn't carry an explicit marker.
  defaultTimezone: string;
  referenceYear: number;
  options?: AutoCreateOptions;
}): Promise<AutoCreateResult> {
  const {
    userId,
    inboxItemId,
    thread,
    userTimezone,
    defaultTimezone,
    referenceYear,
    options = {},
  } = args;

  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const graceWindowMinutes =
    options.graceWindowMinutes ?? DEFAULT_GRACE_MINUTES;
  const calendarCreate = options.calendarCreate ?? defaultCalendarCreate;
  const now = new Date(options.nowMs ?? Date.now());

  // Step 1 — opt-in gate. Default is ON when the field is undefined;
  // the user must explicitly set false to opt out.
  const [userRow] = await db
    .select({
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow) {
    return notCreated("user not found", 0);
  }

  const optedIn = userRow.preferences?.autoCalendarCreate !== false;
  if (!optedIn) {
    return notCreated("user has opted out of auto-calendar-create", 0);
  }

  // Step 2 — idempotency. If a non-cancelled row already exists for
  // this (user, inbox_item), skip — another invocation already created.
  const existing = await db
    .select({ id: autoCreatedCalendarEvents.id })
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.userId, userId),
        eq(autoCreatedCalendarEvents.inboxItemId, inboxItemId),
        ne(autoCreatedCalendarEvents.status, "cancelled"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return notCreated(
      "an auto-created event already exists for this inbox_item",
      0,
    );
  }

  // Step 3 — run the detector.
  const detection = detectMutualAgreement({
    thread,
    userTimezone,
    defaultTimezone,
    referenceYear,
  });

  if (!detection.confirmed || detection.slot === null) {
    return notCreated(detection.reasoning, detection.confidence);
  }

  if (detection.confidence < threshold) {
    return notCreated(
      `confidence ${detection.confidence.toFixed(2)} below threshold ${threshold}`,
      detection.confidence,
    );
  }

  const slot = detection.slot;

  // Step 4 — build the calendar event payload.
  const { startIso, endIso } = buildIsoStartEnd(slot);
  const summary = `[Steadii] ${buildSummaryFromThread(thread)}`;
  const description = buildDescription(detection.reasoning, slot);

  if (options.dryRun) {
    return notCreated(
      "dry-run mode — would have created with confidence " +
        detection.confidence.toFixed(2),
      detection.confidence,
    );
  }

  // Step 5 — call the calendar create tool.
  const created = await calendarCreate({
    userId,
    summary,
    start: startIso,
    end: endIso,
    description,
  });

  // Map the tool's createdIn[] (provider names) into the event_refs
  // jsonb shape. Currently the tool returns a single eventId for the
  // primary provider — Phase 2.5 will extend this to multi-provider.
  const eventRefs: AutoCreatedEventRef[] = created.createdIn.map(
    (provider) => ({
      provider,
      eventId: created.eventId,
      htmlLink: created.htmlLink,
    }),
  );

  // Step 6 — persist the row.
  const graceExpiresAt = new Date(
    now.getTime() + graceWindowMinutes * 60 * 1000,
  );

  const [row] = await db
    .insert(autoCreatedCalendarEvents)
    .values({
      userId,
      inboxItemId,
      eventRefs,
      agreedSlot: slot,
      confidence: detection.confidence,
      graceExpiresAt,
    })
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    action: "created",
    autoCreateId: row.id,
    confidence: detection.confidence,
    eventRefs,
    agreedSlot: slot,
    graceExpiresAt,
  };
}

// ---------- helpers ----------

function notCreated(reason: string, confidence: number): AutoCreateResult {
  return { action: "skipped", reason, confidence };
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

  // End = start + durationMin. Compute by adding minutes to the wall
  // clock, then re-anchor via convertTimezoneSync so the result has
  // the correct offset (handles DST boundary mid-event correctly).
  const [year, month, day] = slot.date.split("-").map((s) => parseInt(s, 10));
  const [hh, mm] = slot.startTime.split(":").map((s) => parseInt(s, 10));
  // Anchor against the start's UTC instant + duration. Using UTC date
  // math here is safe — we're moving along the timeline, not the wall
  // clock — and convertTimezoneSync will re-derive the local wall
  // clock + offset at the destination moment.
  const startUtcMs = Date.parse(startConverted.toIso);
  const endUtcMs = startUtcMs + slot.durationMin * 60 * 1000;
  const endDate = new Date(endUtcMs);

  // Reformat end as wall-clock-in-slot-tz then re-convert (round-trip
  // ensures correct offset under DST). For α scope, all auto-create
  // slots are ≤ a few hours so DST boundary mid-event is a non-issue;
  // we just emit the end ISO directly with the offset that matches
  // the end's instant.
  void year;
  void month;
  void day;
  void hh;
  void mm;
  const endIso = formatInstantWithTzOffset(endDate, slot.timezone);

  return { startIso: startConverted.toIso, endIso };
}

function formatInstantWithTzOffset(d: Date, tz: string): string {
  // Use Intl to get the wall-clock components in tz, then compute the
  // offset by comparing what the same instant looks like as a UTC
  // wall-clock. Same trick convertTimezoneSync uses internally.
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
  // Round-trip through convertTimezoneSync to attach the offset.
  return convertTimezoneSync({
    time: wall,
    fromTz: tz,
    toTz: tz,
    locale: "en",
  }).toIso;
}

function buildSummaryFromThread(thread: EmailSnapshot[]): string {
  // Use the most recent inbound mail's subject (stripped of Re:/Fwd:)
  // when available. Otherwise fall back to a generic title.
  const lastInbound = [...thread]
    .reverse()
    .find((m) => m.direction === "inbound");
  const subj = (lastInbound?.subject ?? "").replace(
    /^(\s*(re|fwd|fw)\s*[:：]\s*)+/gi,
    "",
  );
  return subj.length > 0 ? subj : "Meeting";
}

function buildDescription(reasoning: string, slot: AutoCreatedAgreedSlot): string {
  return [
    "Auto-created by Steadii from a detected mutual scheduling agreement in your email thread.",
    "",
    `Agreed slot: ${slot.date} ${slot.startTime} ${slot.timezone} (${slot.durationMin} min).`,
    "",
    "Detector reasoning:",
    reasoning,
    "",
    "If this is wrong, cancel within 24 hours from your Steadii queue and the event will be removed. After 24 hours the [Steadii] prefix drops automatically.",
  ].join("\n");
}

// Default production calendar create. Wraps `calendarCreateEvent`
// (the tool executor) so test callers can swap it for a mock.
async function defaultCalendarCreate(args: {
  userId: string;
  summary: string;
  start: string;
  end: string;
  description: string;
}): Promise<{
  eventId: string;
  htmlLink: string | null;
  createdIn: Array<"google_calendar" | "microsoft_graph">;
}> {
  const result = await calendarCreateEvent.execute(
    { userId: args.userId },
    {
      summary: args.summary,
      start: args.start,
      end: args.end,
      description: args.description,
    },
  );
  return {
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    createdIn: result.createdIn,
  };
}
