import "server-only";

// 2026-05-21 — Phase 5 of α-auto-cal. Orchestrates the chain:
//
//   inbound email body + subject
//     → detectDeadlineMention(...)
//     → calendar_create_event (all-day, summary: "[Steadii] <topic>")
//     → INSERT into auto_created_calendar_events (kind='deadline', status='provisional')
//
// Shares table + lifecycle + Type G card + grace cron with the
// Phase 2 mutual-agreement evaluator. The only differences are:
//   - The detector is single-sided (inbound mail only, no thread)
//   - The calendar event is all-day (date only, no time)
//   - The agreed_slot.timezone stores the deadline TZ for display
//     (durationMin is meaningless for all-day events — stored as 0)

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  users,
  type AutoCreatedAgreedSlot,
  type AutoCreatedEventRef,
} from "@/lib/db/schema";
import { calendarCreateEvent } from "@/lib/agent/tools/calendar";
import { detectDeadlineMention } from "./deadline-detector";

export type AutoDeadlineCreateOptions = {
  threshold?: number;
  graceWindowMinutes?: number;
  dryRun?: boolean;
  calendarCreate?: CalendarCreateFn;
  nowMs?: number;
};

// Same shape as Phase 2 — kept identical so a single mocked
// implementation can serve both evaluator tests.
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

export type AutoDeadlineResult =
  | { action: "skipped"; reason: string; confidence: number }
  | {
      action: "created";
      autoCreateId: string;
      confidence: number;
      eventRefs: AutoCreatedEventRef[];
      deadlineDate: string;
      graceExpiresAt: Date;
    };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_GRACE_MINUTES = 24 * 60;

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
  const graceWindowMinutes =
    options.graceWindowMinutes ?? DEFAULT_GRACE_MINUTES;
  const calendarCreate = options.calendarCreate ?? defaultCalendarCreate;
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

  // Idempotency — partial unique index on (user_id, inbox_item_id, kind).
  // Lookup the deadline-kind row specifically; a mutual_agreement row
  // for the same inbox_item is fine and allowed to coexist.
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

  // All-day event payload — calendar_create_event accepts YYYY-MM-DD
  // strings for `start` and `end` (treated as all-day by Google).
  const summary = `[Steadii] ${deadline.topic} (締切)`;
  const description = buildDescription(detection.reasoning, deadline);

  if (options.dryRun) {
    return notCreated(
      "dry-run mode — would have created with confidence " +
        detection.confidence.toFixed(2),
      detection.confidence,
    );
  }

  const created = await calendarCreate({
    userId,
    summary,
    start: deadline.date,
    end: deadline.date,
    description,
  });

  const eventRefs: AutoCreatedEventRef[] = created.createdIn.map(
    (provider) => ({
      provider,
      eventId: created.eventId,
      htmlLink: created.htmlLink,
    }),
  );

  // Persist via the same table — kind='deadline', timezone preserved
  // for display, durationMin=0 since it's all-day.
  const agreedSlot: AutoCreatedAgreedSlot = {
    date: deadline.date,
    startTime: "00:00",
    timezone: deadline.timezone,
    durationMin: 0,
  };

  const graceExpiresAt = new Date(
    now.getTime() + graceWindowMinutes * 60 * 1000,
  );

  const [row] = await db
    .insert(autoCreatedCalendarEvents)
    .values({
      userId,
      inboxItemId,
      eventRefs,
      agreedSlot,
      kind: "deadline",
      confidence: detection.confidence,
      graceExpiresAt,
    })
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    action: "created",
    autoCreateId: row.id,
    confidence: detection.confidence,
    eventRefs,
    deadlineDate: deadline.date,
    graceExpiresAt,
  };
}

function notCreated(reason: string, confidence: number): AutoDeadlineResult {
  return { action: "skipped", reason, confidence };
}

function buildDescription(
  reasoning: string,
  deadline: { date: string; timezone: string; topic: string },
): string {
  return [
    "Auto-added by Steadii from a deadline detected in your email.",
    "",
    `Deadline: ${deadline.date} (${deadline.timezone}).`,
    `Topic: ${deadline.topic}`,
    "",
    "Detector reasoning:",
    reasoning,
    "",
    "If this isn't an actual deadline, cancel within 24 hours from your Steadii queue and the event will be removed. After 24 hours the [Steadii] prefix drops automatically.",
  ].join("\n");
}

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
