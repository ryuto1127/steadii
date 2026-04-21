import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections, registeredResources, accounts } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getCalendarForUser } from "@/lib/integrations/google/calendar";
import { getUserTimezone } from "./preferences";
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

  const [timezone, calendarEventsThisWeek] = await Promise.all([
    getUserTimezone(userId),
    safelyFetchWeekEvents(userId),
  ]);

  return {
    timezone,
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
    calendarEventsThisWeek,
  };
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
