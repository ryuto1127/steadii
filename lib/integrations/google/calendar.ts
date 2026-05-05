import "server-only";
import { google, type calendar_v3 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { decryptOAuthToken } from "@/lib/auth/oauth-tokens";
import { persistRefreshedOAuthToken } from "@/lib/auth/oauth-refresh-persist";

export class CalendarNotConnectedError extends Error {
  code = "CALENDAR_NOT_CONNECTED" as const;
  constructor() {
    super("Google Calendar is not connected for this user.");
  }
}

export async function getCalendarForUser(
  userId: string
): Promise<calendar_v3.Calendar> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!row) throw new CalendarNotConnectedError();
  if (!row.scope?.includes("calendar")) throw new CalendarNotConnectedError();

  const e = env();
  const oauth2 = new google.auth.OAuth2(e.AUTH_GOOGLE_ID, e.AUTH_GOOGLE_SECRET);
  oauth2.setCredentials({
    access_token: decryptOAuthToken(row.access_token) ?? undefined,
    refresh_token: decryptOAuthToken(row.refresh_token) ?? undefined,
    expiry_date: row.expires_at ? row.expires_at * 1000 : undefined,
    scope: row.scope ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await persistRefreshedOAuthToken({
        provider: "google",
        providerAccountId: row.providerAccountId,
        accessTokenPlain: tokens.access_token,
        expiresAtSeconds: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : row.expires_at,
      });
    }
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

// Lightweight event row used by the draft pass to ground availability
// answers in the user's actual schedule. Day-events surface as
// `start === end === "YYYY-MM-DDT00:00:00Z"` — drafts treat those as
// "blocking the whole day" hints rather than a specific clash.
export type DraftCalendarEvent = {
  title: string;
  start: string; // ISO
  end: string; // ISO
  location: string | null;
};

// Fetch upcoming events in a fixed window around the email's "now". We
// don't try to parse the email for specific dates — the LLM has the body
// and the events list, it can correlate. The 7-day default covers the
// common "free this week?" / "Thursday at 3pm?" requests; longer windows
// inflate the prompt without much marginal value at α scale.
export async function fetchUpcomingEvents(
  userId: string,
  options: { days?: number; max?: number } = {}
): Promise<DraftCalendarEvent[]> {
  const days = options.days ?? 7;
  const max = options.max ?? 25;
  let cal: calendar_v3.Calendar;
  try {
    cal = await getCalendarForUser(userId);
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return [];
    throw e;
  }
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const resp = await cal.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: max,
  });
  return (resp.data.items ?? [])
    .filter((e) => e.start?.dateTime || e.start?.date)
    .map((e) => ({
      title: e.summary ?? "(untitled)",
      start: e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`,
      end: e.end?.dateTime ?? `${e.end?.date}T00:00:00Z`,
      location: e.location ?? null,
    }));
}
