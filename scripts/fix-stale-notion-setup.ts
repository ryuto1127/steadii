/**
 * scripts/fix-stale-notion-setup.ts
 *
 * One-time maintenance script.
 *
 * Walks every notion_connections row that has a classes_db_id set, probes
 * Notion to see whether that database still exists, and if it doesn't,
 * clears the five set-up-related columns (classes_db_id, mistakes_db_id,
 * assignments_db_id, syllabi_db_id, parent_page_id) plus setup_completed_at.
 *
 * After running this, the affected user's next /onboarding visit will behave
 * exactly like a first-time connect: re-auth Notion with "All pages" access
 * and re-run setup to get a fresh workspace.
 *
 * Usage:
 *   pnpm tsx scripts/fix-stale-notion-setup.ts             # reports + fixes
 *   pnpm tsx scripts/fix-stale-notion-setup.ts --dry-run   # reports only
 *
 * Requires DATABASE_URL and ENCRYPTION_KEY in the environment (.env.local
 * is auto-loaded).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { Client } from "@notionhq/client";
import { notionConnections } from "../lib/db/schema";
import { decryptWith } from "../lib/utils/crypto-primitives";

async function databaseStillExists(client: Client, databaseId: string): Promise<boolean> {
  try {
    await client.databases.retrieve({ database_id: databaseId });
    return true;
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    const status = (err as unknown as { status?: number }).status ?? null;
    const code = (err as unknown as { code?: string }).code ?? null;
    if (status === 404 || code === "object_not_found") return false;
    if (
      /object_not_found/i.test(err.message) ||
      /Could not find (database|page|block)/i.test(err.message)
    )
      return false;
    throw err;
  }
}

type StaleRow = {
  id: string;
  userId: string;
  workspaceName: string | null;
  classesDbId: string;
};

async function run() {
  const dryRun = process.argv.includes("--dry-run");

  const url = process.env.DATABASE_URL;
  const rawKey = process.env.ENCRYPTION_KEY;
  if (!url) throw new Error("DATABASE_URL not set");
  if (!rawKey) throw new Error("ENCRYPTION_KEY not set");
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  }

  const sql = neon(url);
  const db = drizzle(sql, { schema: { notionConnections } });

  const rows = await db.select().from(notionConnections);
  console.log(`scanning ${rows.length} notion_connections row(s)…`);

  const stale: StaleRow[] = [];
  const missingToken: string[] = [];
  const transient: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    if (!row.classesDbId) continue;
    let token: string;
    try {
      token = decryptWith(row.accessTokenEncrypted, key);
    } catch {
      missingToken.push(row.id);
      continue;
    }
    const client = new Client({ auth: token });
    try {
      const alive = await databaseStillExists(client, row.classesDbId);
      if (!alive) {
        stale.push({
          id: row.id,
          userId: row.userId,
          workspaceName: row.workspaceName ?? null,
          classesDbId: row.classesDbId,
        });
      }
    } catch (err) {
      transient.push({
        id: row.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`stale rows: ${stale.length}`);
  for (const s of stale) {
    console.log(
      `  - connection ${s.id} (user ${s.userId}, workspace "${
        s.workspaceName ?? "?"
      }") has dead classes_db_id ${s.classesDbId}`
    );
  }
  if (missingToken.length) {
    console.log(
      `skipped ${missingToken.length} row(s) with undecryptable token (token key changed?)`
    );
  }
  if (transient.length) {
    console.log(
      `skipped ${transient.length} row(s) that failed transiently (not treated as stale):`
    );
    for (const t of transient) console.log(`  - ${t.id}: ${t.reason}`);
  }

  if (dryRun) {
    console.log("(dry run — no writes)");
    return;
  }

  for (const s of stale) {
    await db
      .update(notionConnections)
      .set({
        classesDbId: null,
        mistakesDbId: null,
        assignmentsDbId: null,
        syllabiDbId: null,
        parentPageId: null,
        setupCompletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(notionConnections.id, s.id));
  }

  console.log(`cleared setup on ${stale.length} row(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
