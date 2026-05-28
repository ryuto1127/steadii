import "server-only";

// 2026-05-27 — Scheduled-event propose-insert wrapper. Mirrors
// auto-deadline-create.ts: opt-in gate, idempotency on kind='event',
// INSERT a `status='proposed'` row. The ONLY difference from the
// deadline wrapper is the row is TIMED (real durationMin, real
// startTime) rather than all-day.
//
//   inbound email body + subject
//     → detectScheduledEvent(...)
//     → INSERT into auto_created_calendar_events
//       (kind='event', status='proposed', event_refs=[],
//        agreed_slot={date,startTime,timezone,durationMin},
//        grace_expires_at = now + 7d)
//
// Shares table + lifecycle + Type G' card + expiry cron with the
// mutual-agreement (Phase 2) and deadline (Phase 5) evaluators.
//
// Consent-first lock: NO calendar API call here. The calendar event is
// only created when the user clicks Add in the queue.

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  users,
  type AutoCreatedAgreedSlot,
} from "@/lib/db/schema";
import { detectScheduledEvent } from "./event-detector";

export type AutoEventCreateOptions = {
  threshold?: number;
  expiryWindowMinutes?: number;
  dryRun?: boolean;
  nowMs?: number;
};

export type AutoEventResult =
  | { action: "skipped"; reason: string; confidence: number }
  | {
      action: "proposed";
      autoCreateId: string;
      confidence: number;
      eventDate: string;
      startTime: string;
      expiresAt: Date;
    };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_EXPIRY_MINUTES = 7 * 24 * 60;

export async function evaluateAndAddEventIfDetected(args: {
  userId: string;
  inboxItemId: string;
  // The latest inbound mail's body + subject. No thread context
  // needed — the detector is single-sided.
  body: string;
  subject?: string;
  // Sender's TZ (typically from infer_sender_timezone). Used as the
  // default when no marker appears near the date/time.
  defaultTimezone: string;
  referenceYear: number;
  // Email's received timestamp (epoch ms) — past-dated events are
  // suppressed against this. Defaults to Date.now() in the detector.
  receivedAtMs?: number;
  options?: AutoEventCreateOptions;
}): Promise<AutoEventResult> {
  const {
    userId,
    inboxItemId,
    body,
    subject,
    defaultTimezone,
    referenceYear,
    receivedAtMs,
    options = {},
  } = args;

  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const expiryWindowMinutes =
    options.expiryWindowMinutes ?? DEFAULT_EXPIRY_MINUTES;
  const now = new Date(options.nowMs ?? Date.now());

  // Opt-in gate — same flag as the other auto-cal kinds.
  const [userRow] = await db
    .select({ preferences: users.preferences })
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

  // Idempotency — partial unique index on (user_id, inbox_item_id, kind)
  // WHERE status != 'cancelled'. Lookup the event-kind row specifically;
  // mutual_agreement / deadline rows for the same inbox_item coexist.
  const existing = await db
    .select({ id: autoCreatedCalendarEvents.id })
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.userId, userId),
        eq(autoCreatedCalendarEvents.inboxItemId, inboxItemId),
        eq(autoCreatedCalendarEvents.kind, "event"),
        ne(autoCreatedCalendarEvents.status, "cancelled"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return notCreated(
      "an event-kind auto-create already exists for this inbox_item",
      0,
    );
  }

  // Run the detector.
  const detection = detectScheduledEvent({
    body,
    subject,
    defaultTimezone,
    referenceYear,
    nowMs: receivedAtMs,
  });

  if (!detection.confirmed || detection.event === null) {
    return notCreated(detection.reasoning, detection.confidence);
  }
  if (detection.confidence < threshold) {
    return notCreated(
      `confidence ${detection.confidence.toFixed(2)} below threshold ${threshold}`,
      detection.confidence,
    );
  }

  const event = detection.event;

  if (options.dryRun) {
    return notCreated(
      "dry-run mode — would have proposed with confidence " +
        detection.confidence.toFixed(2),
      detection.confidence,
    );
  }

  // Persist via the shared table — kind='event', TIMED (real
  // startTime + durationMin). The topic rides alongside the structural
  // fields in the JSONB blob so the Add action can title the event
  // without a fresh column. NO calendar API call.
  const agreedSlot: AutoCreatedAgreedSlot & { topic?: string } = {
    date: event.date,
    startTime: event.startTime,
    timezone: event.timezone,
    durationMin: event.durationMin,
    topic: event.topic,
  };

  const expiresAt = new Date(
    now.getTime() + expiryWindowMinutes * 60 * 1000,
  );

  const [row] = await db
    .insert(autoCreatedCalendarEvents)
    .values({
      userId,
      inboxItemId,
      eventRefs: [],
      status: "proposed",
      agreedSlot,
      kind: "event",
      confidence: detection.confidence,
      graceExpiresAt: expiresAt,
    })
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    action: "proposed",
    autoCreateId: row.id,
    confidence: detection.confidence,
    eventDate: event.date,
    startTime: event.startTime,
    expiresAt,
  };
}

function notCreated(reason: string, confidence: number): AutoEventResult {
  return { action: "skipped", reason, confidence };
}
