import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  events as eventsTable,
  eventPreBriefs,
  inboxItems,
  mistakeNotes,
  users,
  type EventRow,
  type PreBriefBullet,
} from "@/lib/db/schema";
import { generatePreBrief } from "./generate";
import type { PreBriefAttendee, PreBriefInput } from "./types";

// Wave 3.1 — meeting pre-brief scanner.
// Runs every 5 min via QStash. For each user with pre_brief_enabled=true,
// finds events starting in the next 13-18 min that have attendees, and
// generates / refreshes the brief.
//
// Cost gate: SKIP_THRESHOLD_USERS_PER_TICK keeps the cron's worst-case
// cost bounded. Each user iteration is gated by a per-user existence
// check that short-circuits when a fresh brief already covers the
// upcoming window.

// Window (in minutes-from-now) we look at for events to brief. Picking
// 13-18 instead of "exactly 15" gives the 5-min cron slack: a tick at
// minute T catches events at T+13..T+18, the next tick at T+5 catches
// T+18..T+23, etc. Each event is briefed at most once thanks to the
// (user_id, event_id) unique index on event_pre_briefs.
const PRE_BRIEF_WINDOW_MIN_FROM_NOW = 13;
const PRE_BRIEF_WINDOW_MAX_FROM_NOW = 18;

// Maximum number of meetings a single user can have briefed per cron
// tick — guards against runaway spend on a calendar with 30+ meetings
// crammed into the same hour. Anything beyond this falls off the back
// silently; the daily catch-all picks them up if relevant the next day.
const MAX_BRIEFS_PER_USER_PER_TICK = 5;

// Skip events whose title screams "non-academic". Tightened
// 2026-05-11: prior list included "doctor" / "dentist" which fired
// on academic contexts ("doctoral defense", "Dental school admissions
// meeting"). Replaced with strictly non-academic English keywords.
const SKIP_TITLE_KEYWORDS = [
  "lunch",
  "coffee",
  "birthday",
  "out of office",
  "ooo",
  "vacation",
  "haircut",
  "dental",
  "vet",
];

export type ScanReport = {
  considered: number;
  briefed: number;
  cached: number;
  skipped: number;
  failed: number;
};

export async function runPreBriefScan(now: Date = new Date()): Promise<ScanReport> {
  const eligibleUsers = await db
    .select({ id: users.id, timezone: users.timezone })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.preBriefEnabled, true)
      )
    );

  const report: ScanReport = {
    considered: 0,
    briefed: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
  };

  for (const u of eligibleUsers) {
    try {
      const r = await runPreBriefForUser(u.id, now);
      report.considered += r.considered;
      report.briefed += r.briefed;
      report.cached += r.cached;
      report.skipped += r.skipped;
      report.failed += r.failed;
    } catch (err) {
      report.failed += 1;
      Sentry.captureException(err, {
        tags: { feature: "pre_brief_scan" },
        user: { id: u.id },
      });
    }
  }

  return report;
}

export async function runPreBriefForUser(
  userId: string,
  now: Date = new Date()
): Promise<ScanReport> {
  const windowStart = new Date(
    now.getTime() + PRE_BRIEF_WINDOW_MIN_FROM_NOW * 60 * 1000
  );
  const windowEnd = new Date(
    now.getTime() + PRE_BRIEF_WINDOW_MAX_FROM_NOW * 60 * 1000
  );

  const upcoming = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        eq(eventsTable.kind, "event"),
        isNull(eventsTable.deletedAt),
        gte(eventsTable.startsAt, windowStart),
        lte(eventsTable.startsAt, windowEnd)
      )
    )
    .limit(MAX_BRIEFS_PER_USER_PER_TICK * 2);

  const report: ScanReport = {
    considered: 0,
    briefed: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
  };

  let briefedThisTick = 0;
  for (const ev of upcoming) {
    report.considered += 1;
    if (briefedThisTick >= MAX_BRIEFS_PER_USER_PER_TICK) {
      report.skipped += 1;
      continue;
    }

    const attendees = extractAttendees(ev);
    if (attendees.length === 0) {
      report.skipped += 1;
      continue;
    }
    if (looksNonAcademic(ev.title)) {
      report.skipped += 1;
      continue;
    }

    try {
      const result = await briefEvent(userId, ev, attendees);
      if (result === "cached") report.cached += 1;
      else if (result === "briefed") {
        report.briefed += 1;
        briefedThisTick += 1;
      } else {
        report.skipped += 1;
      }
    } catch (err) {
      report.failed += 1;
      Sentry.captureException(err, {
        tags: { feature: "pre_brief_brief_event" },
        user: { id: userId },
        extra: { eventId: ev.id },
      });
    }
  }

  return report;
}

// Returns "cached" if a still-fresh brief existed, "briefed" if a new
// brief was generated, "skipped" for everything else (no class match
// AND no recent emails — the brief would be too sparse to bother).
async function briefEvent(
  userId: string,
  event: EventRow,
  attendees: PreBriefAttendee[]
): Promise<"briefed" | "cached" | "skipped"> {
  const cacheKey = await buildCacheKey(userId, event, attendees);

  const [existing] = await db
    .select()
    .from(eventPreBriefs)
    .where(
      and(
        eq(eventPreBriefs.userId, userId),
        eq(eventPreBriefs.eventId, event.id)
      )
    )
    .limit(1);

  if (existing && existing.cacheKey === cacheKey) {
    return "cached";
  }

  const classContext = await resolveClassContext(userId, event, attendees);
  const recentEmails = await fetchRecentEmailsWithAttendees(
    userId,
    attendees.map((a) => a.email),
    event.startsAt
  );
  const upcomingDeadlines = classContext
    ? await fetchUpcomingDeadlines(userId, classContext.classId, event.startsAt)
    : [];
  const recentMistakes = classContext
    ? await fetchRecentMistakes(userId, classContext.classId)
    : [];

  // Skip if there's truly nothing material to summarize. The user gets
  // no value from "no recent activity with this attendee" cards — fewer
  // empty briefs makes the queue feel curated.
  if (
    recentEmails.length === 0 &&
    upcomingDeadlines.length === 0 &&
    recentMistakes.length === 0
  ) {
    return "skipped";
  }

  const input: PreBriefInput = {
    userId,
    event: {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      description: event.description,
    },
    attendees,
    classContext,
    recentEmails,
    upcomingDeadlines,
    recentMistakes,
  };

  const out = await generatePreBrief(input);

  // expires_at = event start + 1h so post-meeting briefs linger briefly
  // ("what did I just talk about") then drop off the queue.
  const expiresAt = new Date(event.startsAt.getTime() + 60 * 60 * 1000);

  if (existing) {
    await db
      .update(eventPreBriefs)
      .set({
        bullets: out.bullets,
        detailMarkdown: out.detailMarkdown,
        attendeeEmails: attendees.map((a) => a.email),
        cacheKey,
        usageId: out.usageId,
        expiresAt,
        viewedAt: null,
        dismissedAt: null,
      })
      .where(eq(eventPreBriefs.id, existing.id));
  } else {
    await db.insert(eventPreBriefs).values({
      userId,
      eventId: event.id,
      bullets: out.bullets,
      detailMarkdown: out.detailMarkdown,
      attendeeEmails: attendees.map((a) => a.email),
      cacheKey,
      usageId: out.usageId,
      expiresAt,
    });
  }

  return "briefed";
}

// ── Helpers (exported for tests) ────────────────────────────────────

// 2026-05-11 — extracts attendees across Google Calendar, MS Graph, and
// iCal subscription source types. Each provider's `sourceMetadata.attendees`
// has a different per-item shape:
//   • google_calendar: { email, displayName?, self? }
//   • microsoft_graph: { emailAddress: { address, name }, type? }
//   • ical_subscription: { email, name? } (populated by iCal parser when
//     ATTENDEE lines are present — TODO follow-up: most public-subscribed
//     classroom feeds don't carry ATTENDEE so this surface stays empty for
//     them, by design)
//
// Google's `self: true` row is skipped (the brief is for the user, with
// the others). MS Graph doesn't carry a `self` flag — its events are
// fetched from /me/events so the organizer is implicit; we don't have a
// reliable way to drop "self" here, so we keep all addresses and rely on
// the downstream pre-brief generator to handle a 1-attendee meeting.
export function extractAttendees(event: EventRow): PreBriefAttendee[] {
  const supported =
    event.sourceType === "google_calendar" ||
    event.sourceType === "microsoft_graph" ||
    event.sourceType === "ical_subscription";
  if (!supported) return [];
  const meta = (event.sourceMetadata ?? {}) as Record<string, unknown>;
  const raw = meta.attendees;
  if (!Array.isArray(raw)) return [];
  const result: PreBriefAttendee[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const parsed = parseAttendeeShape(item, event.sourceType);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

function parseAttendeeShape(
  item: Record<string, unknown>,
  sourceType: string
): PreBriefAttendee | null {
  // Google shape — plus an iCal-style shape that uses the same { email,
  // name? } keys, so route them through the same branch.
  if (sourceType === "google_calendar" || sourceType === "ical_subscription") {
    const email = typeof item.email === "string" ? item.email : null;
    if (!email) return null;
    if (item.self === true) return null;
    // Google uses `displayName`; iCal uses `name`. Tolerate either.
    const dn =
      typeof item.displayName === "string" && item.displayName.length > 0
        ? item.displayName
        : null;
    const nm =
      typeof item.name === "string" && item.name.length > 0 ? item.name : null;
    return { email, name: dn ?? nm };
  }

  // MS Graph shape — { emailAddress: { address, name }, type?, status? }.
  if (sourceType === "microsoft_graph") {
    const ea = item.emailAddress;
    if (!ea || typeof ea !== "object") return null;
    const eaObj = ea as Record<string, unknown>;
    const email = typeof eaObj.address === "string" ? eaObj.address : null;
    if (!email) return null;
    const name =
      typeof eaObj.name === "string" && eaObj.name.length > 0
        ? eaObj.name
        : null;
    return { email, name };
  }

  return null;
}

export function looksNonAcademic(title: string): boolean {
  const lower = title.toLowerCase();
  for (const kw of SKIP_TITLE_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

export async function buildCacheKey(
  userId: string,
  event: EventRow,
  attendees: PreBriefAttendee[]
): Promise<string> {
  const attendeeKey = [...attendees.map((a) => a.email)].sort().join(",");

  // Most-recent inbound from any attendee — bumps the cache when a new
  // email arrives between briefs.
  const [latestEmail] = await db
    .select({ id: inboxItems.id, receivedAt: inboxItems.receivedAt })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        attendees.length > 0
          ? inArray(
              inboxItems.senderEmail,
              attendees.map((a) => a.email)
            )
          : sql`false`,
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(sql`${inboxItems.receivedAt} desc`)
    .limit(1);

  // Most-recent task touching the relevant class window — bumps the
  // cache when the student adds a deadline before the meeting.
  const [latestTask] = await db
    .select({ id: assignments.id, updatedAt: assignments.updatedAt })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        gt(assignments.dueAt, new Date()),
        lt(assignments.dueAt, event.startsAt),
        isNull(assignments.deletedAt)
      )
    )
    .orderBy(sql`${assignments.updatedAt} desc`)
    .limit(1);

  const eventStamp = event.updatedAt.toISOString();
  const emailStamp = latestEmail?.receivedAt?.toISOString() ?? "none";
  const taskStamp = latestTask?.updatedAt?.toISOString() ?? "none";

  return `att:${attendeeKey}|ev:${eventStamp}|email:${emailStamp}|task:${taskStamp}`;
}

async function resolveClassContext(
  userId: string,
  event: EventRow,
  attendees: PreBriefAttendee[]
): Promise<PreBriefInput["classContext"]> {
  // Heuristic 1: if any attendee email matches a known class's professor
  // field, that's the class.
  if (attendees.length > 0) {
    const cls = await db
      .select()
      .from(classes)
      .where(
        and(
          eq(classes.userId, userId),
          isNull(classes.deletedAt),
          inArray(
            sql`lower(${classes.professor})`,
            attendees.map((a) => a.email.toLowerCase())
          )
        )
      )
      .limit(1);
    if (cls[0]) {
      return {
        classId: cls[0].id,
        name: cls[0].name,
        code: cls[0].code,
      };
    }
  }

  // Heuristic 2: if the event title contains a known class code, use it.
  const userClasses = await db
    .select()
    .from(classes)
    .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)));
  for (const c of userClasses) {
    if (c.code && event.title.toLowerCase().includes(c.code.toLowerCase())) {
      return { classId: c.id, name: c.name, code: c.code };
    }
  }
  return null;
}

async function fetchRecentEmailsWithAttendees(
  userId: string,
  attendeeEmails: string[],
  before: Date
): Promise<PreBriefInput["recentEmails"]> {
  if (attendeeEmails.length === 0) return [];
  const since = new Date(before.getTime() - 60 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: inboxItems.id,
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      receivedAt: inboxItems.receivedAt,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.senderEmail, attendeeEmails),
        gte(inboxItems.receivedAt, since),
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(sql`${inboxItems.receivedAt} desc`)
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    senderEmail: r.senderEmail,
    senderName: r.senderName,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.receivedAt,
  }));
}

async function fetchUpcomingDeadlines(
  userId: string,
  classId: string,
  beforeDate: Date
): Promise<PreBriefInput["upcomingDeadlines"]> {
  const horizon = new Date(beforeDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ title: assignments.title, due: assignments.dueAt })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.classId, classId),
        ne(assignments.status, "done"),
        isNull(assignments.deletedAt),
        gt(assignments.dueAt, beforeDate),
        lt(assignments.dueAt, horizon)
      )
    )
    .orderBy(sql`${assignments.dueAt} asc`)
    .limit(8);
  return rows
    .filter((r) => r.due !== null)
    .map((r) => ({ title: r.title, due: r.due as Date }));
}

async function fetchRecentMistakes(
  userId: string,
  classId: string
): Promise<PreBriefInput["recentMistakes"]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      title: mistakeNotes.title,
      unit: mistakeNotes.unit,
      bodyMarkdown: mistakeNotes.bodyMarkdown,
    })
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.userId, userId),
        eq(mistakeNotes.classId, classId),
        gte(mistakeNotes.createdAt, since),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .orderBy(sql`${mistakeNotes.createdAt} desc`)
    .limit(5);
  return rows.map((r) => ({
    title: r.title,
    unit: r.unit,
    bodySnippet: (r.bodyMarkdown ?? "").slice(0, 240),
  }));
}

// Pull the cached brief content for a single event id — used by both the
// queue builder (to render the Type B informational card) and the detail
// page.
export async function getPreBriefByEvent(
  userId: string,
  eventId: string
): Promise<{
  id: string;
  bullets: PreBriefBullet[];
  detailMarkdown: string | null;
  expiresAt: Date;
  createdAt: Date;
} | null> {
  const [row] = await db
    .select()
    .from(eventPreBriefs)
    .where(
      and(
        eq(eventPreBriefs.userId, userId),
        eq(eventPreBriefs.eventId, eventId)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    bullets: row.bullets,
    detailMarkdown: row.detailMarkdown,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
