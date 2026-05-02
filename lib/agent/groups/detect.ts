import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  events as eventsTable,
  groupProjects,
  inboxItems,
} from "@/lib/db/schema";
import type { GroupCandidate } from "./types";

// Thresholds locked in `project_wave_3_design.md`:
//   - 3+ messages × 3+ unique participants × 7+ day active window
//   - calendar event with 3+ attendees of same email domain
//
// Detection runs as part of the daily proactive scan. We surface each
// candidate as a Type E clarifying card; user confirm spawns the
// group_projects row. Already-tracked candidates are skipped via the
// detectionKey lookup against existing group_projects.source_thread_ids.

const MIN_THREAD_MESSAGES = 3;
const MIN_THREAD_PARTICIPANTS = 3;
const MIN_THREAD_ACTIVE_DAYS = 7;
const MIN_CALENDAR_ATTENDEES = 3;

export async function detectGroupCandidates(
  userId: string
): Promise<GroupCandidate[]> {
  const horizon = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [emailCands, calCands, existingThreadIds] = await Promise.all([
    detectFromEmailThreads(userId, horizon),
    detectFromCalendarEvents(userId, horizon),
    listAlreadyTrackedThreadIds(userId),
  ]);

  const all = [...emailCands, ...calCands].filter(
    (c) => !sharesAnyThread(c, existingThreadIds)
  );
  // Dedup by detectionKey — multiple signals on the same project should
  // collapse to one card.
  const seen = new Map<string, GroupCandidate>();
  for (const c of all) {
    if (seen.has(c.detectionKey)) {
      const prior = seen.get(c.detectionKey)!;
      prior.signals.push(...c.signals);
      // Union member emails
      const merged = new Set([...prior.memberEmails, ...c.memberEmails]);
      prior.memberEmails = [...merged];
    } else {
      seen.set(c.detectionKey, c);
    }
  }
  return [...seen.values()];
}

async function detectFromEmailThreads(
  userId: string,
  horizon: Date
): Promise<GroupCandidate[]> {
  const rows = await db
    .select({
      threadId: inboxItems.threadExternalId,
      senderEmail: inboxItems.senderEmail,
      receivedAt: inboxItems.receivedAt,
      classId: inboxItems.classId,
      subject: inboxItems.subject,
      recipientTo: inboxItems.recipientTo,
      recipientCc: inboxItems.recipientCc,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        isNull(inboxItems.deletedAt),
        gte(inboxItems.receivedAt, horizon)
      )
    );

  type ThreadAgg = {
    threadId: string;
    classId: string | null;
    subject: string | null;
    participants: Set<string>;
    messageCount: number;
    firstAt: Date;
    lastAt: Date;
  };
  const map = new Map<string, ThreadAgg>();
  for (const r of rows) {
    if (!r.threadId) continue;
    const key = r.threadId;
    const ex = map.get(key);
    const allEmails = [
      r.senderEmail,
      ...(r.recipientTo ?? []),
      ...(r.recipientCc ?? []),
    ].filter((e): e is string => Boolean(e));
    if (!ex) {
      map.set(key, {
        threadId: key,
        classId: r.classId,
        subject: r.subject,
        participants: new Set(allEmails),
        messageCount: 1,
        firstAt: r.receivedAt,
        lastAt: r.receivedAt,
      });
    } else {
      ex.messageCount += 1;
      for (const e of allEmails) ex.participants.add(e);
      if (r.receivedAt < ex.firstAt) ex.firstAt = r.receivedAt;
      if (r.receivedAt > ex.lastAt) ex.lastAt = r.receivedAt;
    }
  }

  // For class title resolution, fetch all the user's classes in one go.
  const cls = await db
    .select()
    .from(classes)
    .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)));

  const candidates: GroupCandidate[] = [];
  for (const t of map.values()) {
    if (t.messageCount < MIN_THREAD_MESSAGES) continue;
    if (t.participants.size < MIN_THREAD_PARTICIPANTS) continue;
    const days = (t.lastAt.getTime() - t.firstAt.getTime()) / (24 * 60 * 60 * 1000);
    if (days < MIN_THREAD_ACTIVE_DAYS) continue;

    const matchedClass = t.classId
      ? cls.find((c) => c.id === t.classId)
      : null;
    const suggestedTitle =
      (matchedClass?.code ? `${matchedClass.code} group thread` : null) ??
      (t.subject ? `Group project — ${t.subject}` : "Group thread");
    const members = [...t.participants];
    candidates.push({
      classId: matchedClass?.id ?? null,
      className: matchedClass?.name ?? null,
      classCode: matchedClass?.code ?? null,
      suggestedTitle,
      memberEmails: members,
      signals: [
        {
          kind: "email_thread",
          threadId: t.threadId,
          participants: members,
          messageCount: t.messageCount,
          firstAt: t.firstAt,
          lastAt: t.lastAt,
        },
      ],
      detectionKey: hash(
        ["email_thread", t.threadId, [...members].sort().join(",")].join("|")
      ),
    });
  }
  return candidates;
}

async function detectFromCalendarEvents(
  userId: string,
  horizon: Date
): Promise<GroupCandidate[]> {
  const rows = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        eq(eventsTable.kind, "event"),
        isNull(eventsTable.deletedAt),
        gte(eventsTable.startsAt, horizon)
      )
    );

  const cls = await db
    .select()
    .from(classes)
    .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)));

  const candidates: GroupCandidate[] = [];
  for (const ev of rows) {
    if (ev.sourceType !== "google_calendar") continue;
    const meta = (ev.sourceMetadata ?? {}) as Record<string, unknown>;
    const att = Array.isArray(meta.attendees)
      ? (meta.attendees as Array<Record<string, unknown>>)
      : [];
    const externalEmails = att
      .filter((a) => a.self !== true)
      .map((a) => (typeof a.email === "string" ? a.email : null))
      .filter((e): e is string => Boolean(e));
    if (externalEmails.length < MIN_CALENDAR_ATTENDEES) continue;

    // Same-domain heuristic: most members from the same domain →
    // classmates, not external coordination.
    const domains = new Map<string, number>();
    for (const e of externalEmails) {
      const d = e.split("@")[1] ?? "";
      domains.set(d, (domains.get(d) ?? 0) + 1);
    }
    const dominant = [...domains.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant || dominant[1] < MIN_CALENDAR_ATTENDEES) continue;

    const matchedClass =
      cls.find(
        (c) =>
          c.code &&
          ev.title.toLowerCase().includes(c.code.toLowerCase())
      ) ?? null;

    candidates.push({
      classId: matchedClass?.id ?? null,
      className: matchedClass?.name ?? null,
      classCode: matchedClass?.code ?? null,
      suggestedTitle:
        (matchedClass?.code ? `${matchedClass.code} group sync` : null) ??
        `Group sync — ${ev.title}`,
      memberEmails: externalEmails,
      signals: [
        {
          kind: "calendar_event",
          eventId: ev.id,
          attendeeEmails: externalEmails,
          title: ev.title,
          startsAt: ev.startsAt,
        },
      ],
      detectionKey: hash(
        [
          "calendar_event",
          ev.id,
          [...externalEmails].sort().join(","),
        ].join("|")
      ),
    });
  }
  return candidates;
}

async function listAlreadyTrackedThreadIds(
  userId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ source_thread_ids: groupProjects.sourceThreadIds })
    .from(groupProjects)
    .where(eq(groupProjects.userId, userId));
  const set = new Set<string>();
  for (const r of rows) {
    for (const t of r.source_thread_ids ?? []) set.add(t);
  }
  return set;
}

function sharesAnyThread(c: GroupCandidate, existing: Set<string>): boolean {
  for (const s of c.signals) {
    if (s.kind === "email_thread" && existing.has(s.threadId)) return true;
  }
  return false;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ── Manual group creation ────────────────────────────────────────────

export async function createGroupProject(args: {
  userId: string;
  classId: string | null;
  title: string;
  detectionMethod: "auto" | "manual";
  sourceThreadIds: string[];
  memberEmails: string[];
  // Optional per-member display names harvested from the same source —
  // used to seed `name` on group_project_members for nicer initial UI.
  memberNames?: Record<string, string | null>;
}): Promise<{ id: string }> {
  const [created] = await db
    .insert(groupProjects)
    .values({
      userId: args.userId,
      classId: args.classId,
      title: args.title,
      detectionMethod: args.detectionMethod,
      sourceThreadIds: args.sourceThreadIds,
    })
    .returning({ id: groupProjects.id });
  if (!created) throw new Error("Failed to create group project");

  if (args.memberEmails.length > 0) {
    const { groupProjectMembers } = await import("@/lib/db/schema");
    await db
      .insert(groupProjectMembers)
      .values(
        args.memberEmails.map((email) => ({
          groupProjectId: created.id,
          email,
          name: args.memberNames?.[email] ?? null,
        }))
      )
      .onConflictDoNothing();
  }
  return { id: created.id };
}

// Backfill last_message_at / last_responded_at for a single member so
// silence detection has correct stamps. Called after createGroupProject
// and during the silence cron so newly-imported group rows have signal.
export async function refreshMemberActivity(
  groupProjectId: string,
  userId: string
): Promise<void> {
  const { groupProjectMembers } = await import("@/lib/db/schema");
  const members = await db
    .select()
    .from(groupProjectMembers)
    .where(eq(groupProjectMembers.groupProjectId, groupProjectId));
  for (const m of members) {
    // last_message_at = most recent thread message FROM this member to
    // the user. last_responded_at = most recent message in thread AFTER
    // a message from the user — captures whether the member replied to
    // an out-bound from us.
    const [lastIn] = await db
      .select({ at: inboxItems.receivedAt })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          eq(inboxItems.senderEmail, m.email),
          isNull(inboxItems.deletedAt)
        )
      )
      .orderBy(sql`${inboxItems.receivedAt} desc`)
      .limit(1);

    await db
      .update(groupProjectMembers)
      .set({
        lastMessageAt: lastIn?.at ?? null,
        // We don't track outbound replies precisely yet; conservative
        // proxy: treat last_responded_at = last_message_at so silence
        // detection only fires when the member also stopped sending.
        lastRespondedAt: lastIn?.at ?? null,
      })
      .where(
        and(
          eq(groupProjectMembers.groupProjectId, groupProjectId),
          eq(groupProjectMembers.email, m.email)
        )
      );
  }
}
