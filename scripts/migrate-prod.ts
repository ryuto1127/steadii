import { config } from "dotenv";
// Explicit override: if PROD_DATABASE_URL is provided in shell env, use
// it. Otherwise fall back to .env.production (Vercel env pull). Shell
// override is the usual path because Vercel's Neon integration marks
// DATABASE_URL as a sensitive secret and `vercel env pull` returns it
// as an empty string. Reveal the value in Vercel UI → Settings →
// Environment Variables → DATABASE_URL → 👁 → copy.

config({ path: ".env.production", override: false });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// One-shot prod migration runner. Usage:
//   PROD_DATABASE_URL='<paste from Vercel UI>' pnpm tsx scripts/migrate-prod.ts
//
// Bypasses .env.local which historically pointed at prod but now
// diverges (dev/staging DB) — the 2026-05-04 incident where
// engineer-31 columns landed in dev DB while Vercel prod kept failing
// with "column does not exist".

async function run() {
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Pass PROD_DATABASE_URL='<paste>' (from Vercel UI → Settings → Environment Variables → DATABASE_URL → 👁)."
    );
  }
  const host = new URL(url).hostname;
  console.log(`Migrating against host: ${host}`);

  const sql = neon(url);
  const db = drizzle(sql);

  console.log("Applying migrations...");
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  console.log("Migrations applied.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
