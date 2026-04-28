import "server-only";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentEvents,
  agentProposals,
  agentRules,
  agentSenderFeedback,
  assignments,
  auditLog,
  blobAssets,
  chats,
  classes,
  emailEmbeddings,
  events,
  icalSubscriptions,
  inboxItems,
  mistakeNoteChunks,
  mistakeNotes,
  notionConnections,
  pendingToolCalls,
  registeredResources,
  sendQueue,
  syllabi,
  syllabusChunks,
  topupBalances,
  usageEvents,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { del } from "@vercel/blob";

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

// Wipe-data scope is locked: classes, syllabi, mistakes, assignments,
// chats, inbox, agent state, events, integrations, uploads. NOT touched:
// users row, accounts (OAuth), sessions, subscriptions/invoices,
// processed_stripe_events, waitlist_requests, audit_log, global agent
// rules (which live in code, not the DB).
export async function wipeAllUserData(userId: string): Promise<void> {
  // 1) Read blob URLs up front so we can delete the underlying Vercel
  //    Blob objects after the DB rows are gone. If we deleted DB first
  //    and the read fails, we'd orphan blobs forever.
  const blobs = await db
    .select({ url: blobAssets.url })
    .from(blobAssets)
    .where(eq(blobAssets.userId, userId));

  // 2) DB deletes. Order is conservative — most child tables cascade from
  //    their parent, but we delete leaf-ish rows first so we never have
  //    to rely on cascade semantics across multiple hops.
  await db.delete(sendQueue).where(eq(sendQueue.userId, userId));
  await db
    .delete(agentSenderFeedback)
    .where(eq(agentSenderFeedback.userId, userId));
  await db.delete(agentDrafts).where(eq(agentDrafts.userId, userId));
  await db.delete(agentProposals).where(eq(agentProposals.userId, userId));
  await db.delete(agentEvents).where(eq(agentEvents.userId, userId));
  await db.delete(agentRules).where(eq(agentRules.userId, userId));
  await db.delete(inboxItems).where(eq(inboxItems.userId, userId));
  await db.delete(emailEmbeddings).where(eq(emailEmbeddings.userId, userId));
  await db.delete(usageEvents).where(eq(usageEvents.userId, userId));
  // chats cascades messages, message_attachments
  await db.delete(chats).where(eq(chats.userId, userId));
  // mistakeNotes cascades mistake_note_images
  await db
    .delete(mistakeNoteChunks)
    .where(eq(mistakeNoteChunks.userId, userId));
  await db.delete(syllabusChunks).where(eq(syllabusChunks.userId, userId));
  await db.delete(mistakeNotes).where(eq(mistakeNotes.userId, userId));
  await db.delete(syllabi).where(eq(syllabi.userId, userId));
  await db.delete(assignments).where(eq(assignments.userId, userId));
  await db.delete(classes).where(eq(classes.userId, userId));
  await db.delete(events).where(eq(events.userId, userId));
  await db
    .delete(icalSubscriptions)
    .where(eq(icalSubscriptions.userId, userId));
  // registeredResources cascades from notionConnections; do explicit too
  // in case there are orphans.
  await db
    .delete(registeredResources)
    .where(eq(registeredResources.userId, userId));
  await db
    .delete(notionConnections)
    .where(eq(notionConnections.userId, userId));
  await db
    .delete(pendingToolCalls)
    .where(eq(pendingToolCalls.userId, userId));
  await db.delete(topupBalances).where(eq(topupBalances.userId, userId));
  // blobAssets last — set-null FKs from syllabi / mistake_note_images /
  // message_attachments are already irrelevant since those rows are gone.
  await db.delete(blobAssets).where(eq(blobAssets.userId, userId));

  // 3) Audit. Important: audit_log itself is NOT wiped (it survives the
  //    user's data reset because it's the trail of what happened).
  await db.insert(auditLog).values({
    userId,
    action: "user.wipe_data",
    resourceType: "user",
    resourceId: userId,
    result: "success",
    detail: { blobCount: blobs.length },
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
