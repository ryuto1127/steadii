/**
 * scripts/backfill-admin-flag.ts
 *
 * One-time data migration: sets users.is_admin = true for every user who
 * currently holds an active admin redemption. Run this once after migration
 * 0010 (which adds the is_admin column) and before the effective-plan.ts
 * refactor takes effect, to avoid Ryuto losing admin access during the
 * cutover from redemption-based to flag-based admin detection.
 *
 * Idempotent: re-runs are safe (users already flagged stay flagged).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-admin-flag.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, gt, inArray } from "drizzle-orm";
import { users, redeemCodes, redemptions } from "../lib/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);
  const db = drizzle(sql, { schema: { users, redeemCodes, redemptions } });

  const now = new Date();

  const activeAdminRedemptions = await db
    .select({ userId: redemptions.userId })
    .from(redemptions)
    .innerJoin(redeemCodes, eq(redemptions.codeId, redeemCodes.id))
    .where(
      and(
        eq(redeemCodes.type, "admin"),
        gt(redemptions.effectiveUntil, now)
      )
    );

  const userIds = Array.from(
    new Set(activeAdminRedemptions.map((r) => r.userId))
  );

  if (userIds.length === 0) {
    console.log("no active admin redemptions — nothing to backfill");
    return;
  }

  const result = await db
    .update(users)
    .set({ isAdmin: true, updatedAt: new Date() })
    .where(inArray(users.id, userIds))
    .returning({ id: users.id, email: users.email });

  console.log(`flagged ${result.length} user(s) as is_admin=true:`);
  for (const row of result) {
    console.log(`  ${row.id}  ${row.email}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
