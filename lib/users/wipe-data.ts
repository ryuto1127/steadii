import "server-only";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  assignments,
  auditLog,
  blobAssets,
  chats,
  classes,
  icalSubscriptions,
  inboxItems,
  mistakeNotes,
  notionConnections,
  syllabi,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { WIPE_PLAN, type WipeTarget } from "@/lib/users/wipe-plan";

export type WipeCounts = {
  classes: number;
  syllabi: number;
  mistakes: number;
  assignments: number;
  chats: number;
  messages: number;
  inbox: number;
  proposals: number;
  integrations: number;
  blobs: number;
  blobBytes: number;
};

// Single SELECT per category, scoped by user id. We deliberately don't add
// soft-delete (deletedAt IS NULL) filters here — the wipe action is meant
// to clear *everything*, and the counts modal should reflect what will
// actually be deleted, including soft-deleted rows.
export async function getWipeCounts(userId: string): Promise<WipeCounts> {
  const c = (n: number) => Number(n);
  const [
    classesN,
    syllabiN,
    mistakesN,
    assignmentsN,
    chatsN,
    messagesN,
    inboxN,
    proposalsN,
    notionN,
    icalN,
    blobsRow,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(classes)
      .where(eq(classes.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(syllabi)
      .where(eq(syllabi.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(mistakeNotes)
      .where(eq(mistakeNotes.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(assignments)
      .where(eq(assignments.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(sql`messages m JOIN chats c ON m.chat_id = c.id`)
      .where(sql`c.user_id = ${userId}`)
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(inboxItems)
      .where(eq(inboxItems.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(agentProposals)
      .where(eq(agentProposals.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(notionConnections)
      .where(eq(notionConnections.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(icalSubscriptions)
      .where(eq(icalSubscriptions.userId, userId))
      .then((r) => c(r[0]?.n ?? 0)),
    db
      .select({
        n: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(size_bytes), 0)`,
      })
      .from(blobAssets)
      .where(eq(blobAssets.userId, userId))
      .then((r) => ({
        n: c(r[0]?.n ?? 0),
        bytes: c(r[0]?.bytes ?? 0),
      })),
  ]);

  return {
    classes: classesN,
    syllabi: syllabiN,
    mistakes: mistakesN,
    assignments: assignmentsN,
    chats: chatsN,
    messages: messagesN,
    inbox: inboxN,
    proposals: proposalsN,
    integrations: notionN + icalN,
    blobs: blobsRow.n,
    blobBytes: blobsRow.bytes,
  };
}

// ─── Truth-in-deletion ───────────────────────────────────────────────
//
// The wipe used to delete a hand-maintained list of ~23 tables while the
// schema defined 50+ — third-party PII (entities / entity_links holding
// correspondent names, emails, descriptions and 1536-dim embeddings),
// learned user facts, sender confidence, agent confirmations / personas,
// pre-briefs, intent metadata, notifications, ignored senders, office-
// hours requests, group projects and more all survived a "delete my data"
// click. The in-product promise was false.
//
// Inverted design: lib/users/wipe-plan.ts keeps an explicit allowlist of
// tables that must SURVIVE the wipe (the account itself + auth + the
// billing/audit trail), and derives the delete set from the live drizzle
// schema — every pgTable with a user_id column that isn't kept is a wipe
// target, FK-ordered children-first. A regression test asserts every
// user-scoped table is either kept or wiped, so coverage can't silently
// drift again.

/**
 * Delete every row owned by `userId` from the wipe-set tables, in
 * FK-safe (children-first) order. Returns per-table deleted-row counts
 * for the audit detail.
 */
async function deleteWipeTargets(
  userId: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const target of WIPE_PLAN as readonly WipeTarget[]) {
    const deleted = await db
      .delete(target.table)
      .where(eq(target.userIdColumn, userId))
      .returning({ marker: sql<number>`1` });
    counts[target.tableName] = deleted.length;
  }
  return counts;
}

export async function wipeAllUserData(userId: string): Promise<void> {
  // 1) Read blob URLs up front so we can delete the underlying Vercel
  //    Blob objects after the DB rows are gone. If we deleted DB first
  //    and the read fails, we'd orphan blobs forever.
  const blobs = await db
    .select({ url: blobAssets.url })
    .from(blobAssets)
    .where(eq(blobAssets.userId, userId));

  // 2) DB deletes. WIPE_PLAN is FK-ordered children-first (derived from
  //    the schema's cascade edges), so every delete runs without tripping
  //    a foreign-key constraint even though the users row is kept. Child
  //    tables that cascade from a wiped parent (messages,
  //    message_attachments, mistake_note_images, group_project_members /
  //    _tasks, etc.) are removed by that cascade; the explicit parents in
  //    the plan cover the rest.
  const deletedCounts = await deleteWipeTargets(userId);

  // 3) Audit. audit_log is in KEEP_TABLES — it survives the wipe because
  //    it's the trail of what happened, including this wipe itself.
  await db.insert(auditLog).values({
    userId,
    action: "user.wipe_data",
    resourceType: "user",
    resourceId: userId,
    result: "success",
    detail: { blobCount: blobs.length, deleted: deletedCounts },
  });

  // 4) Best-effort blob cleanup. A failed blob-delete leaves orphans in
  //    Vercel Blob storage but doesn't roll back the DB wipe — the
  //    semantic is "your data is gone from Steadii's view." Vercel Blob
  //    `del` accepts an array; chunk to stay under any soft limits.
  if (blobs.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
    const urls = blobs.map((b) => b.url);
    const CHUNK = 50;
    for (let i = 0; i < urls.length; i += CHUNK) {
      try {
        await del(urls.slice(i, i + CHUNK));
      } catch (err) {
        console.error("[wipe-data] blob del chunk failed", err);
      }
    }
  }
}
