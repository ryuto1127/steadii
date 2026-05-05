import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { encryptOAuthToken } from "@/lib/auth/oauth-tokens";

// Persist a refreshed OAuth access_token (and any rotated companion fields)
// back into the `accounts` row, with a 1-retry + 200ms backoff against
// Neon's transient `fetch failed` blips. Fires from inside the
// integrations' refresh callbacks (Google's `oauth2.on('tokens', ...)` +
// the MS Graph manual refresh path).
//
// Why retry: Neon HTTP serverless can hiccup on cold-start / brief
// disconnect. Without retry, one bad fetch surfaces as an unhandled
// rejection (the `.on('tokens', ...)` emitter does not await the
// callback). The handler has already succeeded for the API caller — only
// the DB write-back fails, and the next refresh tick will rewrite. So
// retry once silently, then degrade to a Sentry warning. Mirrors the
// shape used in `lib/agent/usage.ts:recordUsage` and the signIn callback
// in `lib/auth/config.ts`.
//
// Sentry incident reference: 2026-05-04 ("NeonDbError: fetch failed"
// during accounts.update from Google OAuth2Client).

export type RefreshedTokenWrite = {
  provider: string;
  providerAccountId: string;
  accessTokenPlain: string;
  // null preserves the existing column value (Google's case when the
  // refresh response does not include a new expiry).
  expiresAtSeconds: number | null;
  // Only meaningful for providers that rotate refresh tokens (Microsoft).
  // Google's refresh_token is durable; pass undefined and the column
  // stays untouched.
  refreshTokenPlain?: string | null;
  scope?: string | null;
  tokenType?: string | null;
};

const RETRY_DELAY_MS = 200;

export async function persistRefreshedOAuthToken(
  write: RefreshedTokenWrite
): Promise<void> {
  const update: Partial<typeof accounts.$inferInsert> = {
    access_token: encryptOAuthToken(write.accessTokenPlain),
    updatedAt: new Date(),
  };
  if (write.expiresAtSeconds !== null) {
    update.expires_at = write.expiresAtSeconds;
  }
  if (write.refreshTokenPlain != null) {
    update.refresh_token = encryptOAuthToken(write.refreshTokenPlain);
  }
  if (write.scope != null) update.scope = write.scope;
  if (write.tokenType != null) update.token_type = write.tokenType;

  let firstErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db
        .update(accounts)
        .set(update)
        .where(
          and(
            eq(accounts.provider, write.provider),
            eq(accounts.providerAccountId, write.providerAccountId)
          )
        );
      return;
    } catch (err) {
      if (attempt === 0) {
        firstErr = err;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      Sentry.captureException(err, {
        level: "warning",
        tags: {
          context: "oauth_refresh_persist_failed",
          provider: write.provider,
        },
        extra: {
          firstError: firstErr,
          providerAccountId: write.providerAccountId,
        },
      });
    }
  }
}
