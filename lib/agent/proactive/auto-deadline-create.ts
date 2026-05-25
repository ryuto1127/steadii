import "server-only";

// 2026-05-21 — Phase 5 of α-auto-cal.
// 2026-05-24 — Round-3 propose-confirm flow. The orchestrator no
// longer calls calendarCreateEvent: it INSERTs a `status='proposed'`
// row and lets the Type G' queue card surface
// [追加 / 編集 / 破棄] actions. The actual calendar API call only
// fires from the Add action in app/app/queue-actions.ts.
//
//   inbound email body + subject
//     → detectDeadlineMention(...)
//     → INSERT into auto_created_calendar_events
//       (kind='deadline', status='proposed', event_refs=[],
//        grace_expires_at = now + 7d)
//
// Shares table + lifecycle + Type G card + expiry cron with the
// Phase 2 mutual-agreement evaluator. The only differences are:
//   - The detector is single-sided (inbound mail only, no thread)
//   - When the user clicks Add, the calendar event is created as
//     all-day (date only, no time)
//   - The agreed_slot.timezone stores the deadline TZ for display
//     (durationMin is meaningless for all-day events — stored as 0)

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  users,
  type AutoCreatedAgreedSlot,
} from "@/lib/db/schema";
import { detectDeadlineMention } from "./deadline-detector";

export type AutoDeadlineCreateOptions = {
  threshold?: number;
  expiryWindowMinutes?: number;
  dryRun?: boolean;
  nowMs?: number;
};

export type AutoDeadlineResult =
  | { action: "skipped"; reason: string; confidence: number }
  | {
      action: "proposed";
      autoCreateId: string;
      confidence: number;
      deadlineDate: string;
      expiresAt: Date;
    };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_EXPIRY_MINUTES = 7 * 24 * 60;

export async function evaluateAndAddDeadlineIfDetected(args: {
  userId: string;
  inboxItemId: string;
  // The latest inbound mail's body + subject. No thread context
  // needed — the detector is single-sided.
  body: string;
  subject?: string;
  // Sender's TZ (typically from infer_sender_timezone). Used as the
  // default when no marker appears near the date.
  defaultTimezone: string;
  referenceYear: number;
  options?: AutoDeadlineCreateOptions;
}): Promise<AutoDeadlineResult> {
  const {
    userId,
    inboxItemId,
    body,
    subject,
    defaultTimezone,
    referenceYear,
    options = {},
  } = args;

  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const expiryWindowMinutes =
    options.expiryWindowMinutes ?? DEFAULT_EXPIRY_MINUTES;
  const now = new Date(options.nowMs ?? Date.now());

  // Opt-in gate — same flag as Phase 2 (mutual-agreement).
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
  // WHERE status != 'cancelled'. Lookup the deadline-kind row
  // specifically; a mutual_agreement row for the same inbox_item is
  // fine and allowed to coexist.
  const existing = await db
    .select({ id: autoCreatedCalendarEvents.id })
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.userId, userId),
        eq(autoCreatedCalendarEvents.inboxItemId, inboxItemId),
        eq(autoCreatedCalendarEvents.kind, "deadline"),
        ne(autoCreatedCalendarEvents.status, "cancelled"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return notCreated(
      "a deadline-kind auto-create already exists for this inbox_item",
      0,
    );
  }

  // Run the detector.
  const detection = detectDeadlineMention({
    body,
    subject,
    defaultTimezone,
    referenceYear,
  });

  if (!detection.confirmed || detection.deadline === null) {
    return notCreated(detection.reasoning, detection.confidence);
  }
  if (detection.confidence < threshold) {
    return notCreated(
      `confidence ${detection.confidence.toFixed(2)} below threshold ${threshold}`,
      detection.confidence,
    );
  }

  const deadline = detection.deadline;

  if (options.dryRun) {
    return notCreated(
      "dry-run mode — would have proposed with confidence " +
        detection.confidence.toFixed(2),
      detection.confidence,
    );
  }

  // Persist via the same table — kind='deadline', timezone preserved
  // for display, durationMin=0 since it's all-day. NO calendar API
  // call: the event is only created if/when the user clicks Add.
  const agreedSlot: AutoCreatedAgreedSlot = {
    date: deadline.date,
    startTime: "00:00",
    timezone: deadline.timezone,
    durationMin: 0,
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
      kind: "deadline",
      confidence: detection.confidence,
      graceExpiresAt: expiresAt,
    })
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    action: "proposed",
    autoCreateId: row.id,
    confidence: detection.confidence,
    deadlineDate: deadline.date,
    expiresAt,
  };
}

function notCreated(reason: string, confidence: number): AutoDeadlineResult {
  return { action: "skipped", reason, confidence };
}
