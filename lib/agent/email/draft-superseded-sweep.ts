import "server-only";

// 2026-05-21 — Auto-resolves pending draft_reply queue items when the
// user has already replied to the thread DIRECTLY via Gmail (not
// through Steadii's Send button). Without this sweep, short replies
// typed straight into Gmail leave stale draft cards in the Steadii
// queue forever.
//
// Detection signal: Gmail `users.threads.get(format=metadata)` returns
// every message in the thread with labelIds. We look for a message
// labelled `SENT` whose internalDate exceeds the originating
// inbox_item.receivedAt. If present, the user has replied since
// Steadii surfaced the draft → flip status to
// 'superseded_by_user_send' and remove from the queue.
//
// Resilience:
//   - Per-draft failures are logged + skipped, NOT fatal
//   - Gmail-not-connected users are skipped silently (no draft can be
//     surfaced for them anyway)
//   - Gmail 404/410 (thread deleted) flips status the same way —
//     "user dealt with this" is the conservative assumption

import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  type AgentDraftStatus,
} from "@/lib/db/schema";

export type DraftSupersededSweepResult = {
  scanned: number;
  superseded: number;
  skipped: number;
};

// Injectable so unit tests can stub Gmail without spinning up a real
// OAuth client.
export type SentSinceProbe = (args: {
  userId: string;
  threadExternalId: string;
  afterMs: number;
}) => Promise<boolean>;

// Cap on rows processed in one sweep — bounds Gmail API quota usage
// and keeps the cron invocation under Vercel's 30s lambda window.
const DEFAULT_LIMIT = 100;

export async function runDraftSupersededSweep(args: {
  limit?: number;
  probe: SentSinceProbe;
}): Promise<DraftSupersededSweepResult> {
  const { probe, limit = DEFAULT_LIMIT } = args;

  const rows = await db
    .select({
      draftId: agentDrafts.id,
      userId: agentDrafts.userId,
      inboxItemId: agentDrafts.inboxItemId,
      threadExternalId: inboxItems.threadExternalId,
      receivedAt: inboxItems.receivedAt,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.status, "pending"),
        // Only draft_reply is gated on user-replies-elsewhere. The
        // other actions (notify_only, ask_clarifying) have their own
        // resolution surfaces.
        inArray(agentDrafts.action, ["draft_reply"]),
      ),
    )
    .limit(limit);

  let superseded = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.threadExternalId) {
      skipped++;
      continue;
    }
    try {
      const hasSentReply = await probe({
        userId: row.userId,
        threadExternalId: row.threadExternalId,
        afterMs: row.receivedAt.getTime(),
      });
      if (!hasSentReply) continue;

      const newStatus: AgentDraftStatus = "superseded_by_user_send";
      await db
        .update(agentDrafts)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(agentDrafts.id, row.draftId));
      superseded++;
    } catch (err) {
      skipped++;
      Sentry.captureException(err, {
        tags: { feature: "draft_superseded", phase: "sweep" },
        user: { id: row.userId },
        extra: { draftId: row.draftId },
      });
    }
  }

  return { scanned: rows.length, superseded, skipped };
}

// ---------- production probe (Gmail-backed) ----------

export async function defaultSentSinceProbe(): Promise<SentSinceProbe> {
  const { getGmailForUser, GmailNotConnectedError } = await import(
    "@/lib/integrations/google/gmail"
  );
  return async ({ userId, threadExternalId, afterMs }) => {
    try {
      const gmail = await getGmailForUser(userId);
      const res = await gmail.users.threads.get({
        userId: "me",
        id: threadExternalId,
        format: "metadata",
        metadataHeaders: ["From"],
      });
      const messages = res.data.messages ?? [];
      for (const m of messages) {
        const internalMs = Number(m.internalDate ?? 0);
        if (!Number.isFinite(internalMs) || internalMs <= afterMs) continue;
        const labels = m.labelIds ?? [];
        if (labels.includes("SENT")) return true;
      }
      return false;
    } catch (err) {
      if (err instanceof GmailNotConnectedError) return false;
      const status = (err as { status?: number; code?: number })
        .status ?? (err as { code?: number }).code;
      // Thread deleted / permissions revoked → conservative: treat
      // as "user dealt with it" so the queue card disappears.
      if (status === 404 || status === 410) return true;
      throw err;
    }
  };
}
