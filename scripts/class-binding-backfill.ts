/**
 * scripts/class-binding-backfill.ts
 *
 * One-shot backfill for the inbox_items.class_id / class_binding_method /
 * class_binding_confidence columns introduced by Phase 7 W1. Iterates
 * every inbox_items row that lacks a class_binding_method (rows ingested
 * before W1 landed) and runs `bindEmailToClass` against it. Idempotent —
 * re-running rebinds, but the result is stable for the same inputs.
 *
 * Usage:
 *
 *   pnpm tsx scripts/class-binding-backfill.ts
 *
 * Flags:
 *   --dry        Print the plan, don't write rows.
 *   --limit=N    Process at most N items this run.
 *   --user=UUID  Restrict to one user.
 *   --rebind     Rebind even rows that already have a method set.
 */
// Env loading happens in scripts/_register.cjs before any import resolves.
import { db } from "@/lib/db/client";
import {
  inboxItems,
  emailEmbeddings,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  bindEmailToClass,
  persistBinding,
} from "@/lib/agent/email/class-binding";

type Flags = {
  dry: boolean;
  limit: number | null;
  userId: string | null;
  rebind: boolean;
};

function parseFlags(argv: string[]): Flags {
  let dry = false;
  let limit: number | null = null;
  let userId: string | null = null;
  let rebind = false;
  for (const a of argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a === "--rebind") rebind = true;
    else if (a.startsWith("--limit=")) limit = Number(a.split("=")[1]);
    else if (a.startsWith("--user=")) userId = a.split("=")[1]!;
  }
  return { dry, limit, userId, rebind };
}

async function main() {
  const flags = parseFlags(process.argv);
  const startedAt = Date.now();

  const allItems = await db
    .select({
      id: inboxItems.id,
      userId: inboxItems.userId,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      senderRole: inboxItems.senderRole,
      classBindingMethod: inboxItems.classBindingMethod,
    })
    .from(inboxItems)
    .where(
      flags.userId
        ? and(isNull(inboxItems.deletedAt), eq(inboxItems.userId, flags.userId))
        : isNull(inboxItems.deletedAt)
    );

  const queue = flags.rebind
    ? allItems
    : allItems.filter((i) => i.classBindingMethod === null);
  const toProcess = flags.limit ? queue.slice(0, flags.limit) : queue;

  console.log(
    `[class-binding-backfill] ${allItems.length} total items, ${queue.length} to bind; processing ${toProcess.length}${flags.dry ? " (DRY RUN)" : ""}`
  );

  let processed = 0;
  let bound = 0;
  let unbound = 0;
  let failed = 0;
  const perMethod = new Map<string, number>();

  for (const item of toProcess) {
    // Reuse the email_embeddings vector when present so we don't issue a
    // fresh embed per backfill row.
    const [emb] = await db
      .select({ embedding: emailEmbeddings.embedding })
      .from(emailEmbeddings)
      .where(eq(emailEmbeddings.inboxItemId, item.id))
      .limit(1);

    try {
      const result = await bindEmailToClass({
        userId: item.userId,
        subject: item.subject,
        bodySnippet: item.snippet,
        senderEmail: item.senderEmail,
        senderName: item.senderName,
        senderRole: item.senderRole,
        queryEmbedding: emb?.embedding ?? null,
      });
      processed++;
      perMethod.set(
        result.method,
        (perMethod.get(result.method) ?? 0) + 1
      );
      if (result.classId) bound++;
      else unbound++;
      if (!flags.dry) {
        await persistBinding(item.id, result);
      }
    } catch (err) {
      failed++;
      console.error(
        `[class-binding-backfill] ${item.id} failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log("[class-binding-backfill] done");
  console.log(`  processed:  ${processed}`);
  console.log(`  bound:      ${bound}`);
  console.log(`  unbound:    ${unbound}`);
  console.log(`  failed:     ${failed}`);
  console.log(`  duration:   ${(durationMs / 1000).toFixed(1)}s`);
  for (const [method, n] of perMethod.entries()) {
    console.log(`  method ${method}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
