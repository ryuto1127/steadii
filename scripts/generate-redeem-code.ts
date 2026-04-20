/**
 * scripts/generate-redeem-code.ts
 *
 * Generate a single redeem code. Admin-only (α-era: runs locally against
 * the dev or prod DB via DATABASE_URL).
 *
 * Usage:
 *   pnpm tsx scripts/generate-redeem-code.ts admin --days 365
 *   pnpm tsx scripts/generate-redeem-code.ts friend --days 30 --note "for J"
 *   pnpm tsx scripts/generate-redeem-code.ts friend --days 90 --max-uses 5
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { redeemCodes } from "../lib/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const type = process.argv[2];
  if (type !== "admin" && type !== "friend") {
    console.error("first arg must be 'admin' or 'friend'");
    process.exit(2);
  }
  const days = Number(arg("days") ?? "30");
  const maxUses = Number(arg("max-uses") ?? "1");
  const note = arg("note") ?? null;

  if (!Number.isFinite(days) || days <= 0) {
    console.error("--days must be positive");
    process.exit(2);
  }
  if (!Number.isFinite(maxUses) || maxUses <= 0) {
    console.error("--max-uses must be positive");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);
  const db = drizzle(sql, { schema: { redeemCodes } });

  const code = generateHumanishCode(type);

  const [row] = await db
    .insert(redeemCodes)
    .values({
      code,
      type,
      durationDays: days,
      maxUses,
      note,
    })
    .returning();

  console.log(JSON.stringify(row, null, 2));
  console.log(`\nShare this code: ${code}`);
}

function generateHumanishCode(type: "admin" | "friend"): string {
  // 20 hex chars, reasonably short and copy-pasteable.
  const body = randomBytes(8).toString("hex").toUpperCase();
  return `STEADII-${type.toUpperCase().slice(0, 1)}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
