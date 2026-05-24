import "server-only";

// 2026-05-21 — Phase 2 of α-auto-cal.
// 2026-05-24 — Round-3 propose-confirm flow. The orchestrator no
// longer calls calendarCreateEvent: it INSERTs a `status='proposed'`
// row and surfaces a Type G' queue card with explicit
// [追加 / 編集 / 破棄] actions. The actual calendar API call only
// fires from the Add action in app/app/queue-actions.ts. This honors
// Ryuto's "prepare but don't act" principle — the user's Google
// Calendar is never touched without per-event consent.
//
//   thread input
//     → detectMutualAgreement(...)
//     → INSERT into auto_created_calendar_events (status='proposed',
//       event_refs=[], grace_expires_at = now + 7d)
//
// Conservative bias inherited from the detector (Phase 1):
//   - Confidence ≥ 0.80 is required for auto-create
//   - User must be opted in (preferences.autoCalendarCreate !== false)
//     — the opt-in is "let the agent SURFACE proposals," not "let the
//     agent CREATE events"; the latter requires per-event user click
//   - Idempotency: one non-cancelled row per (user, inbox_item, kind)
//
// The 7-day expiry replaces the legacy 24h grace window. Untouched
// 'proposed' rows are auto-cancelled by the master-sweep cron's
// auto-cal-proposal-expiry sub-sweep — no calendar action since the
// event was never created.

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  users,
  type AutoCreatedAgreedSlot,
} from "@/lib/db/schema";
import {
  detectMutualAgreement,
  type EmailSnapshot,
} from "./mutual-agreement-detector";

export type AutoCreateOptions = {
  // Threshold for `confirmed: true` to fire the propose. Defaults to 0.80.
  threshold?: number;
  // Proposal expiry window in minutes. Defaults to 10080 (7 days).
  // Untouched proposals past this window are auto-cancelled (no
  // calendar action) by the auto-cal-proposal-expiry sub-sweep.
  expiryWindowMinutes?: number;
  // For tests / dry runs: when true, skip the DB write.
  dryRun?: boolean;
  // Override `now()` for deterministic tests.
  nowMs?: number;
};

export type AutoCreateResult =
  | { action: "skipped"; reason: string; confidence: number }
  | {
      action: "proposed";
      autoCreateId: string;
      confidence: number;
      agreedSlot: AutoCreatedAgreedSlot;
      expiresAt: Date;
    };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_EXPIRY_MINUTES = 7 * 24 * 60;

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
  const expiryWindowMinutes =
    options.expiryWindowMinutes ?? DEFAULT_EXPIRY_MINUTES;
  const now = new Date(options.nowMs ?? Date.now());

  // Step 1 — opt-in gate. Default is ON when the field is undefined;
  // the user must explicitly set false to opt out. The opt-in here
  // means "let the agent SURFACE proposals" — the actual calendar
  // write still requires per-event user confirmation in the queue.
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
  // this (user, inbox_item), skip — another invocation already
  // proposed (or the user is mid-flight on it).
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

  if (options.dryRun) {
    return notCreated(
      "dry-run mode — would have proposed with confidence " +
        detection.confidence.toFixed(2),
      detection.confidence,
    );
  }

  // Step 4 — persist the proposal row. NO calendar API call: the
  // event will only be created if the user clicks Add in the queue.
  // event_refs starts empty and is populated only when the Add
  // server action runs the calendar create + flips status to
  // 'confirmed'.
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
      agreedSlot: slot,
      confidence: detection.confidence,
      graceExpiresAt: expiresAt,
    })
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    action: "proposed",
    autoCreateId: row.id,
    confidence: detection.confidence,
    agreedSlot: slot,
    expiresAt,
  };
}

// ---------- helpers ----------

function notCreated(reason: string, confidence: number): AutoCreateResult {
  return { action: "skipped", reason, confidence };
}
