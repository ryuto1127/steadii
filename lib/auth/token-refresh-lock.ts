import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

// Per-user token-refresh mutex via Postgres advisory lock. Wraps `fn` in a
// transaction that holds `pg_advisory_xact_lock` keyed by `hashtext(key)`
// for the lock's lifetime; concurrent callers with the same key block
// until the holder commits / rolls back. Multi-process safe — required
// for Vercel serverless where two simultaneous invocations against the
// same user can otherwise both hit a provider's /token endpoint with the
// same refresh_token (MS rotates RTs, so the loser's RT becomes invalid).
//
// Inside the lock, callers should re-read the relevant row before
// deciding to refresh — another caller may already have done it.
export async function withTokenRefreshLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    return await fn();
  });
}
