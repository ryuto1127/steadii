import "server-only";
import * as Sentry from "@sentry/nextjs";
import { google, type gmail_v1 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";
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

// Wave 5 — surface the "your Gmail token went stale" condition. Called
// from any token-refresh path that detects invalid_grant (user revoked
// access, password reset, app-permission revoked from the Google
// account dashboard, etc.). Stamps the user row so the layout's
// re-connect banner appears; cleared on successful re-auth.
export async function markGmailTokenRevoked(userId: string): Promise<void> {
  try {
    await db
      .update(users)
      .set({ gmailTokenRevokedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { integration: "gmail", op: "mark_token_revoked" },
      user: { id: userId },
    });
  }
}

export async function clearGmailTokenRevoked(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ gmailTokenRevokedAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Pattern test for the OAuth error shape googleapis emits when the
// refresh token is rejected. The exact path is `error.response.data.error`
// for HTTP 4xx, but the message also reliably contains "invalid_grant"
// as a substring; checking both keeps the detection robust to driver
// updates.
export function isInvalidGrantError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (msg.includes("invalid_grant")) return true;
  type GaxiosLike = {
    response?: { data?: { error?: unknown } };
    code?: unknown;
  };
  const e = err as GaxiosLike;
  const respError = e?.response?.data?.error;
  if (typeof respError === "string" && respError === "invalid_grant") {
    return true;
  }
  return false;
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
      try {
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
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "token_refresh_persist" },
          user: { id: userId },
        });
      }
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
