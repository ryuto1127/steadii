/**
 * scripts/embed-backfill.ts
 *
 * One-shot backfill for the email_embeddings table. Iterates every
 * inbox_items row that lacks an embedding and generates one via the same
 * helper the live ingest uses. Idempotent + resumable: the unique
 * constraint on email_embeddings.inbox_item_id makes re-runs cheap.
 *
 * Usage:
 *
 *   pnpm tsx scripts/embed-backfill.ts
 *
 * Expected cost at α: < $1 total. Prints per-user counts + total cost at
 * the end.
 *
 * Flags:
 *   --dry        Print the plan, don't call OpenAI or write rows.
 *   --limit=N    Process at most N items this run.
 *   --user=UUID  Restrict to one user.
 */
// Env loading happens in scripts/_register.cjs before any import resolves
// — ESM hoists imports above this module's top-level code, so inline
// dotenv here would run too late.
import { db } from "@/lib/db/client";
import { inboxItems, emailEmbeddings } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import {
  buildEmbedInput,
  embedAndStoreInboxItem,
} from "@/lib/agent/email/embeddings";
import { estimateUsdCost } from "@/lib/agent/models";

type Flags = { dry: boolean; limit: number | null; userId: string | null };

function parseFlags(argv: string[]): Flags {
  let dry = false;
  let limit: number | null = null;
  let userId: string | null = null;
  for (const a of argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--limit=")) limit = Number(a.split("=")[1]);
    else if (a.startsWith("--user=")) userId = a.split("=")[1]!;
  }
  return { dry, limit, userId };
}

async function main() {
  const flags = parseFlags(process.argv);
  const startedAt = Date.now();

  // Left-anti-join via NOT EXISTS would be nicer but Drizzle's raw filter
  // on a subquery adds friction. We scan inbox_items in chunks and filter
  // in-app. α scale makes this fine.
  const allItems = await db
    .select({
      id: inboxItems.id,
      userId: inboxItems.userId,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
    })
    .from(inboxItems)
    .where(
      flags.userId
        ? and(isNull(inboxItems.deletedAt), eq(inboxItems.userId, flags.userId))
        : isNull(inboxItems.deletedAt)
    );

  // Build a set of inbox_item_ids that already have embeddings.
  const existing = await db
    .select({ inboxItemId: emailEmbeddings.inboxItemId })
    .from(emailEmbeddings);
  const covered = new Set(existing.map((r) => r.inboxItemId));

  const queue = allItems.filter((i) => !covered.has(i.id));
  const toProcess = flags.limit ? queue.slice(0, flags.limit) : queue;

  console.log(
    `[embed-backfill] ${allItems.length} total items, ${covered.size} already embedded, ${queue.length} remaining; processing ${toProcess.length}${flags.dry ? " (DRY RUN)" : ""}`
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalTokens = 0;
  const perUser = new Map<string, number>();

  for (const item of toProcess) {
    const input = buildEmbedInput(item.subject, item.snippet);
    if (!input) {
      skipped++;
      continue;
    }
    if (flags.dry) {
      processed++;
      continue;
    }
    try {
      const result = await embedAndStoreInboxItem({
        userId: item.userId,
        inboxItemId: item.id,
        subject: item.subject,
        body: item.snippet,
      });
      if (result) {
        processed++;
        perUser.set(item.userId, (perUser.get(item.userId) ?? 0) + 1);
        // We can't read back the exact token count cheaply here without
        // re-querying; approximate with 4 chars/token on the clamped input.
        totalTokens += Math.ceil(input.length / 4);
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[embed-backfill] ${item.id} failed: ${err instanceof Error ? err.message : err}`
      );
    }
    // Small delay to stay well under OpenAI rate limits. 20ms × α volume
    // (≤5k items) ~= 100s total — fine for a manual run.
    if (processed % 50 === 0) await sleep(200);
  }

  const approxUsd = estimateUsdCost("text-embedding-3-small", {
    input: totalTokens,
    output: 0,
    cached: 0,
  });

  const durationMs = Date.now() - startedAt;
  console.log("[embed-backfill] done");
  console.log(`  processed:    ${processed}`);
  console.log(`  skipped:      ${skipped}`);
  console.log(`  failed:       ${failed}`);
  console.log(`  approx tokens: ${totalTokens}`);
  console.log(`  approx cost:   $${approxUsd.toFixed(5)}`);
  console.log(`  duration:      ${(durationMs / 1000).toFixed(1)}s`);
  for (const [uid, n] of perUser.entries()) {
    console.log(`  user ${uid}: ${n}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
