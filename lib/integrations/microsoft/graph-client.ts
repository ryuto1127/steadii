import "server-only";
import { Client } from "@microsoft/microsoft-graph-client";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  decryptOAuthToken,
  encryptOAuthToken,
} from "@/lib/auth/oauth-tokens";
import { withTokenRefreshLock } from "@/lib/auth/token-refresh-lock";

const PROVIDER_ID = "microsoft-entra-id";
const TOKEN_ENDPOINT = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

export class MsNotConnectedError extends Error {
  code = "MS_NOT_CONNECTED" as const;
  constructor() {
    super("Microsoft 365 is not connected for this user.");
  }
}

type AccountRow = typeof accounts.$inferSelect;

async function loadAccount(userId: string): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, PROVIDER_ID)))
    .limit(1);
  if (!row) throw new MsNotConnectedError();
  return row;
}

function isExpired(expiresAtUnixSec: number | null | undefined): boolean {
  if (!expiresAtUnixSec) return true;
  // Refresh 60s ahead of the wire expiry to absorb clock skew.
  return expiresAtUnixSec * 1000 - 60_000 <= Date.now();
}

async function refreshAccessToken(row: AccountRow): Promise<string> {
  const e = env();
  const refresh = decryptOAuthToken(row.refresh_token);
  if (!refresh) throw new MsNotConnectedError();
  if (!e.AUTH_MS_ID || !e.AUTH_MS_SECRET) throw new MsNotConnectedError();

  const tenant = e.AUTH_MS_TENANT_ID || "common";
  const body = new URLSearchParams({
    client_id: e.AUTH_MS_ID,
    client_secret: e.AUTH_MS_SECRET,
    grant_type: "refresh_token",
    refresh_token: refresh,
    // MS rejects /common refresh requests without an explicit scope echo.
    // We don't need to widen here — the original consent set the ceiling.
    scope: row.scope ?? "openid email profile offline_access User.Read",
  });

  const resp = await fetch(TOKEN_ENDPOINT(tenant), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    // 400 with `invalid_grant` means the refresh_token was revoked or
    // expired (90-day inactivity). Surface as not-connected so callers
    // soft-fail; the user re-authorises from the connections page.
    throw new MsNotConnectedError();
  }

  const json = (await resp.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };

  const newExpiresAt = Math.floor(Date.now() / 1000) + json.expires_in;
  const update: Partial<typeof accounts.$inferInsert> = {
    access_token: encryptOAuthToken(json.access_token),
    expires_at: newExpiresAt,
    updatedAt: new Date(),
  };
  if (json.refresh_token)
    update.refresh_token = encryptOAuthToken(json.refresh_token);
  if (json.scope) update.scope = json.scope;
  if (json.token_type) update.token_type = json.token_type;

  await db
    .update(accounts)
    .set(update)
    .where(
      and(
        eq(accounts.provider, PROVIDER_ID),
        eq(accounts.providerAccountId, row.providerAccountId)
      )
    );

  return json.access_token;
}

// Serialise the refresh path per-user via a Postgres advisory lock. Without
// this, two concurrent invocations (Vercel serverless) can both POST to MS
// with the same refresh_token — MS rotates RTs, so the loser's stored RT
// is now dead and the next refresh fails with invalid_grant. Inside the
// lock we re-read the row in case another caller already refreshed; only
// hit the network if still expired.
async function refreshWithMutex(row: AccountRow): Promise<string> {
  return await withTokenRefreshLock(
    `ms-token:${row.userId}:${row.providerAccountId}`,
    async () => {
      const [fresh] = await db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.provider, PROVIDER_ID),
            eq(accounts.providerAccountId, row.providerAccountId)
          )
        )
        .limit(1);
      if (!fresh) throw new MsNotConnectedError();

      const cachedAccess = decryptOAuthToken(fresh.access_token);
      if (cachedAccess && !isExpired(fresh.expires_at)) {
        // Another caller refreshed while we waited on the lock — adopt.
        row.access_token = fresh.access_token;
        row.refresh_token = fresh.refresh_token;
        row.expires_at = fresh.expires_at;
        row.scope = fresh.scope;
        return cachedAccess;
      }
      const access = await refreshAccessToken(fresh);
      // Reload the post-refresh state into the caller's in-memory row so
      // subsequent Graph calls in the same request don't see stale fields.
      const [post] = await db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.provider, PROVIDER_ID),
            eq(accounts.providerAccountId, row.providerAccountId)
          )
        )
        .limit(1);
      if (post) {
        row.access_token = post.access_token;
        row.refresh_token = post.refresh_token;
        row.expires_at = post.expires_at;
        row.scope = post.scope;
      }
      return access;
    }
  );
}

// Returns a Microsoft Graph SDK Client whose auth provider lazily refreshes
// the access token on every request. The SDK calls `getAccessToken` per
// request, so even long-lived clients stay valid across multiple Graph
// hops without us having to thread the token through manually.
export async function getMsGraphForUser(userId: string): Promise<Client> {
  const row = await loadAccount(userId);

  return Client.init({
    authProvider: async (done) => {
      try {
        let access = decryptOAuthToken(row.access_token);
        if (!access || isExpired(row.expires_at)) {
          access = await refreshWithMutex(row);
        }
        done(null, access);
      } catch (err) {
        done(err as Error, null);
      }
    },
  });
}

// Helper for callers that need the linked account row (e.g. to read scope
// before deciding whether to render a connect prompt).
export async function getMsAccount(
  userId: string
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, PROVIDER_ID)))
    .limit(1);
  return row ?? null;
}

export const MS_PROVIDER_ID = PROVIDER_ID;
