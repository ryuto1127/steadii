/**
 * scripts/encrypt-oauth-tokens.ts
 *
 * One-shot backfill. Run AFTER deploying the code that writes encrypted
 * tokens, not before — otherwise fresh OAuth logins would land as
 * plaintext and this script would skip them (prefix check would never
 * match). Idempotent: re-running is a no-op for already-prefixed rows.
 *
 *   pnpm tsx scripts/encrypt-oauth-tokens.ts
 */
import "dotenv/config";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  encryptOAuthToken,
  isEncryptedOAuthToken,
} from "@/lib/auth/oauth-tokens";

async function main() {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.provider, "google"));

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const needs = {
      refresh_token:
        row.refresh_token && !isEncryptedOAuthToken(row.refresh_token),
      access_token:
        row.access_token && !isEncryptedOAuthToken(row.access_token),
      id_token: row.id_token && !isEncryptedOAuthToken(row.id_token),
    };
    if (!needs.refresh_token && !needs.access_token && !needs.id_token) {
      skipped += 1;
      continue;
    }

    await db
      .update(accounts)
      .set({
        refresh_token: needs.refresh_token
          ? encryptOAuthToken(row.refresh_token)
          : row.refresh_token,
        access_token: needs.access_token
          ? encryptOAuthToken(row.access_token)
          : row.access_token,
        id_token: needs.id_token
          ? encryptOAuthToken(row.id_token)
          : row.id_token,
        updatedAt: new Date(),
      })
      .where(eq(accounts.providerAccountId, row.providerAccountId));
    updated += 1;
    console.log(`encrypted: user=${row.userId} provider=${row.provider}`);
  }

  console.log(`\nDone. updated=${updated} already-encrypted=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
