import "server-only";
import { google, type calendar_v3 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";

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
    access_token: row.access_token ?? undefined,
    refresh_token: row.refresh_token ?? undefined,
    expiry_date: row.expires_at ? row.expires_at * 1000 : undefined,
    scope: row.scope ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await db
        .update(accounts)
        .set({
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : row.expires_at,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accounts.provider, "google"),
            eq(accounts.providerAccountId, row.providerAccountId)
          )
        );
    }
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}
