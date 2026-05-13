import "server-only";
import { db } from "@/lib/db/client";
import {
  accounts,
  assignments as assignmentsTable,
  classes as classesTable,
  mistakeNotes,
  notionConnections,
  registeredResources,
  syllabi,
} from "@/lib/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { getCalendarForUser } from "@/lib/integrations/google/calendar";
import { getUserLocale, getUserTimezone } from "./preferences";
import { loadTopUserFacts } from "./user-facts";
export {
  serializeContextForPrompt,
  type UserContextPayload,
} from "./serialize-context";
import type { UserContextPayload } from "./serialize-context";

export async function buildUserContext(userId: string): Promise<UserContextPayload> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);

  const resources = conn
    ? await db
        .select()
        .from(registeredResources)
        .where(
          and(
            eq(registeredResources.userId, userId),
            isNull(registeredResources.archivedAt)
          )
        )
    : [];

  const [
    timezone,
    locale,
    calendarEventsThisWeek,
    classCount,
    activeAssignmentCount,
    mistakeCount,
    syllabusCount,
    userFactsList,
  ] = await Promise.all([
    getUserTimezone(userId),
    getUserLocale(userId),
    safelyFetchWeekEvents(userId),
    countRows(classesTable, userId, true),
    countRows(assignmentsTable, userId, true, "active"),
    countRows(mistakeNotes, userId, true),
    countRows(syllabi, userId, true),
    loadTopUserFacts(userId),
  ]);

  return {
    timezone,
    locale,
    notion: {
      connected: !!conn,
      parentPageId: conn?.parentPageId ?? null,
      classesDbId: conn?.classesDbId ?? null,
      mistakesDbId: conn?.mistakesDbId ?? null,
      assignmentsDbId: conn?.assignmentsDbId ?? null,
      syllabiDbId: conn?.syllabiDbId ?? null,
    },
    registeredResources: resources.map((r) => ({
      kind: r.resourceType,
      notionId: r.notionId,
      title: r.title,
    })),
    academicCounts: {
      classes: classCount,
      assignmentsActive: activeAssignmentCount,
      mistakeNotes: mistakeCount,
      syllabi: syllabusCount,
    },
    calendarEventsThisWeek,
    userFacts: userFactsList.map((f) => ({
      fact: f.fact,
      category: f.category,
    })),
  };
}

type CountableTable = typeof classesTable
  | typeof assignmentsTable
  | typeof mistakeNotes
  | typeof syllabi;

async function countRows(
  table: CountableTable,
  userId: string,
  excludeDeleted: boolean,
  flavor?: "active"
): Promise<number> {
  // Drizzle infers the userId/deletedAt columns by exact column reference;
  // every academic entity follows the same shape (userId + deletedAt).
  const conditions = [eq(table.userId, userId)];
  if (excludeDeleted) conditions.push(isNull(table.deletedAt));
  if (flavor === "active" && "status" in table) {
    // Count assignments not done. Cast keeps Drizzle happy across the
    // tagged union of tables.
    const t = table as typeof assignmentsTable;
    conditions.push(eq(t.status, "not_started"));
  }
  const [row] = await db
    .select({ n: count() })
    .from(table)
    .where(and(...conditions));
  return Number(row?.n ?? 0);
}

async function safelyFetchWeekEvents(userId: string) {
  const [acct] = await db
    .select({ scope: accounts.scope })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!acct?.scope?.includes("calendar")) return [];

  try {
    const cal = await getCalendarForUser(userId);
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: weekOut.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 25,
    });
    return (resp.data.items ?? []).map((e) => ({
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
    }));
  } catch (err) {
    console.error("Week events fetch failed, proceeding without", err);
    return [];
  }
}
