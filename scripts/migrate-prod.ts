// 2026-05-12 — Prod migration helper. Replaces the prior PROD_DATABASE_URL
// paste-from-Vercel-UI flow. Now discovers the prod connection string via
// the Neon REST API using a personal-access token, so sparring can run
// migrations without Ryuto manually shuttling the URL each time.
//
// Flow:
//   1. Reads NEONCTL_API_KEY from process.env (set via .env.local).
//   2. Calls Neon REST API to find the steadii project + production
//      branch + connection URI.
//   3. Runs Drizzle migrator OR a journal-only sync (when the migration
//      SQL was already auto-applied to prod and we just need to record
//      it in drizzle.__drizzle_migrations).
//
// The auto-apply pattern is documented in
// memory/feedback_prod_migration_manual.md — migrations 0036, 0037 (and
// likely beyond) ended up in prod without an explicit `pnpm db:migrate`
// run, root cause unknown. For those, `--journal-only NN` records the
// entry so Drizzle's migrator next-run doesn't re-attempt the SQL.
//
// Usage:
//   pnpm tsx scripts/migrate-prod.ts                       # full migrate
//   pnpm tsx scripts/migrate-prod.ts --journal-only 38 39  # sync entries 38 + 39
//   pnpm tsx scripts/migrate-prod.ts --diagnose            # show current journal state
//
// Required env (in .env.local — only Ryuto sets this once):
//   NEONCTL_API_KEY  Neon personal access token. Generate at
//                    https://console.neon.tech → Profile → API Keys.
//
// Optional env (auto-discovered if unset):
//   NEON_PROJECT_ID    Neon project id (auto-discovered from name match "steadii")
//   NEON_PROD_BRANCH   Branch name (default "production"; falls back to "main" / primary)
//   NEON_DATABASE      Database name (default "neondb")
//   NEON_ROLE          Role name (default "neondb_owner")

import { config } from "dotenv";
config({ path: ".env.local" });

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { sql as drizzleSql } from "drizzle-orm";

const NEON_API_KEY = process.env.NEONCTL_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const NEON_PROD_BRANCH = process.env.NEON_PROD_BRANCH ?? "production";
const NEON_DATABASE = process.env.NEON_DATABASE ?? "neondb";
const NEON_ROLE = process.env.NEON_ROLE ?? "neondb_owner";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "lib/db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
  version: string;
  breakpoints: boolean;
};

type Journal = { entries: JournalEntry[]; version: string };

async function neonApi<T>(apiPath: string): Promise<T> {
  if (!NEON_API_KEY) {
    throw new Error(
      "NEONCTL_API_KEY not set. Add it to .env.local — generate at Neon Console → Profile → API Keys."
    );
  }
  const res = await fetch(`https://console.neon.tech/api/v2${apiPath}`, {
    headers: {
      Authorization: `Bearer ${NEON_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Neon API ${apiPath}: ${res.status} ${res.statusText} — ${await res.text()}`
    );
  }
  return (await res.json()) as T;
}

async function discoverProdConnectionString(): Promise<string> {
  let projectId = NEON_PROJECT_ID;
  if (!projectId) {
    type Proj = { id: string; name: string };
    type Projects = { projects: Proj[] };
    const { projects } = await neonApi<Projects>("/projects");
    const matched = projects.find((p) =>
      p.name.toLowerCase().includes("steadii")
    );
    if (!matched) {
      throw new Error(
        `No 'steadii' project found among Neon projects. Available: ${projects
          .map((p) => p.name)
          .join(", ")}. Set NEON_PROJECT_ID explicitly.`
      );
    }
    projectId = matched.id;
  }

  type Branch = { id: string; name: string; primary?: boolean };
  type Branches = { branches: Branch[] };
  const { branches } = await neonApi<Branches>(
    `/projects/${projectId}/branches`
  );
  const prodBranch =
    branches.find((b) => b.name === NEON_PROD_BRANCH) ??
    branches.find((b) => b.name === "main") ??
    branches.find((b) => b.primary === true);
  if (!prodBranch) {
    throw new Error(
      `No '${NEON_PROD_BRANCH}' / 'main' / primary branch found. Available: ${branches
        .map((b) => b.name)
        .join(", ")}`
    );
  }

  type UriResp = { uri: string };
  const { uri } = await neonApi<UriResp>(
    `/projects/${projectId}/connection_uri?branch_id=${prodBranch.id}&database_name=${NEON_DATABASE}&role_name=${NEON_ROLE}&pooled=true`
  );
  return uri;
}

function hashMigration(idxStr: string): { hash: string; tag: string; when: number } {
  const journal: Journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
  const idx = parseInt(idxStr, 10);
  const entry = journal.entries.find((e) => e.idx === idx);
  if (!entry) {
    throw new Error(
      `Journal entry ${idx} not found. Available: ${journal.entries
        .map((e) => e.idx)
        .join(", ")}`
    );
  }
  const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
  const content = fs.readFileSync(sqlPath, "utf-8");
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return { hash, tag: entry.tag, when: entry.when };
}

async function diagnose(connectionString: string): Promise<void> {
  const sqlClient = neon(connectionString);
  const db = drizzle(sqlClient);
  const tableCheck = await db.execute(drizzleSql`
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_name = '__drizzle_migrations'
  `);
  console.log("__drizzle_migrations table location:", tableCheck.rows);

  if (tableCheck.rows.length === 0) {
    console.log("Table does not exist yet — first migrator run will create it.");
    return;
  }

  const rows = await db.execute(drizzleSql`
    SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
    ORDER BY id DESC LIMIT 12
  `);
  console.log("Last 12 journal entries:", rows.rows);
}

async function journalOnlySync(
  connectionString: string,
  indices: string[]
): Promise<void> {
  const sqlClient = neon(connectionString);
  const db = drizzle(sqlClient);

  // Mirror Drizzle migrator's bootstrap so a manual sync before any prior
  // migrator run still works. CREATE IF NOT EXISTS makes it idempotent.
  await db.execute(drizzleSql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const idxStr of indices) {
    const { hash, tag, when } = hashMigration(idxStr);
    const existing = await db.execute(drizzleSql`
      SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
    `);
    if (existing.rows.length > 0) {
      console.log(`Migration ${idxStr} (${tag}) already in journal — skip.`);
      continue;
    }
    await db.execute(drizzleSql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${when})
    `);
    console.log(
      `Migration ${idxStr} (${tag}) journal entry inserted. hash=${hash.slice(0, 12)}…`
    );
  }
}

async function fullMigrate(connectionString: string): Promise<void> {
  const sqlClient = neon(connectionString);
  const db = drizzle(sqlClient);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

async function main() {
  const args = process.argv.slice(2);
  console.log("Fetching prod connection string from Neon API…");
  const url = await discoverProdConnectionString();
  const host = new URL(url).hostname;
  console.log(`Got prod URL for host: ${host}`);

  if (args[0] === "--diagnose") {
    await diagnose(url);
    return;
  }
  if (args[0] === "--journal-only") {
    const indices = args.slice(1);
    if (indices.length === 0) {
      throw new Error(
        "--journal-only requires migration indices, e.g. --journal-only 38 39"
      );
    }
    await journalOnlySync(url, indices);
    return;
  }
  await fullMigrate(url);
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
