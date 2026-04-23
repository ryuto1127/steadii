import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import {
  decryptOAuthToken,
  encryptOAuthToken,
} from "@/lib/auth/oauth-tokens";

export class GmailNotConnectedError extends Error {
  code = "GMAIL_NOT_CONNECTED" as const;
  constructor() {
    super("Gmail is not connected for this user.");
  }
}

// Returns a Gmail API client bound to the user's OAuth credentials. Mirrors
// `getCalendarForUser` / `getTasksForUser` verbatim — same refresh-token
// callback, same decryption wrapping. Scope gate: we require *some* gmail.*
// in the space-delimited scope string. Substring match works because the
// two Gmail scopes we request (gmail.modify, gmail.send) are the only
// Google scopes that contain the literal "gmail".
export async function getGmailForUser(
  userId: string
): Promise<gmail_v1.Gmail> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!row) throw new GmailNotConnectedError();
  if (!row.scope?.includes("gmail")) throw new GmailNotConnectedError();

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
      await db
        .update(accounts)
        .set({
          access_token: encryptOAuthToken(tokens.access_token),
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

  return google.gmail({ version: "v1", auth: oauth2 });
}

export async function getGoogleProviderAccountId(
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ providerAccountId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  return row?.providerAccountId ?? null;
}
