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
// 2026-05-24 (Round 5 / PR #319) — also write an agent_notifications
// row so the auto-resolve is reversible for 24h via the activity feed
// inline [元に戻す] button. The detection + state-flip behaviour is
// unchanged; the notification is purely additive surface so the user
// has recourse if our detection was wrong (e.g. the user replied to a
// DIFFERENT thread by the same sender). Per the consent-first
// principle lock.
//
// Resilience:
//   - Per-draft failures are logged + skipped, NOT fatal
//   - Gmail-not-connected users are skipped silently (no draft can be
//     surfaced for them anyway)
//   - Gmail 404/410 (thread deleted) flips status the same way —
//     "user dealt with this" is the conservative assumption
//   - Notification insert is best-effort: failing it does NOT roll back
//     the status flip (the user wanted the queue clean above all). A
//     Sentry capture records the drop so we can fix it forward.

import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentNotifications,
  inboxItems,
  type AgentDraftStatus,
} from "@/lib/db/schema";

// 24h reversibility window. Exported so the server action + tests can
// reference the same constant without drift.
export const AUTO_RESOLVE_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      // Round 5 — fetch the surface fields the notification summary
      // needs so it renders without an extra round-trip.
      subject: inboxItems.subject,
      senderEmail: inboxItems.senderEmail,
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
      const now = new Date();
      // 2026-05-24 (PR 3) — also write the canonical disposition signal.
      // The queue read path filters on disposition='active'; without
      // this mirror the auto-resolved draft would stay visible until
      // a release of the queue builder.
      await db
        .update(agentDrafts)
        .set({
          status: newStatus,
          disposition: "resolved",
          updatedAt: now,
        })
        .where(eq(agentDrafts.id, row.draftId));
      superseded++;

      // 2026-05-24 (Round 5) — write the notification row so the user
      // has 24h to undo if our detection was wrong. Best-effort: a
      // failure here is captured but does NOT roll back the status
      // flip (the queue cleanup is more important than the undo
      // surface, and the audit row from the caller still records the
      // event for forensics).
      try {
        await db.insert(agentNotifications).values({
          userId: row.userId,
          kind: "auto_resolved_draft",
          subjectTable: "agent_drafts",
          subjectId: row.draftId,
          summary: buildAutoResolveSummary({
            subject: row.subject,
            senderEmail: row.senderEmail,
          }),
          undoableUntil: new Date(now.getTime() + AUTO_RESOLVE_UNDO_WINDOW_MS),
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "draft_superseded", phase: "notification_insert" },
          user: { id: row.userId },
          extra: { draftId: row.draftId },
        });
      }
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

// ---------- notification summary helper ----------

// Build a short human-readable summary for the activity feed
// notification row. Prefers the subject; falls back to the sender
// email; falls back to a generic phrase. Capped at 120 chars so the
// timeline stays scannable per the agentNotifications.summary
// comment in lib/db/schema.ts.
export function buildAutoResolveSummary(args: {
  subject: string | null;
  senderEmail: string | null;
}): string {
  const subject = args.subject?.trim();
  const sender = args.senderEmail?.trim();
  const label = subject && subject.length > 0
    ? subject
    : sender && sender.length > 0
      ? sender
      : "a thread";
  const full = `Auto-resolved draft for ${label}`;
  return full.length > 120 ? `${full.slice(0, 117)}...` : full;
}

// ---------- notification expiry sub-sweep ----------

// Clears `undoable_until` on notifications whose 24h reversibility
// window has elapsed. The row stays visible in the activity feed
// without the undo button — historical record, no destructive change.
// `dismissed_at` is NOT touched here: the user never explicitly
// dismissed; the cron just bookkept the deadline.
export type NotificationExpirySweepResult = {
  expired: number;
};

export async function runNotificationExpirySweep(args: {
  // Injected for tests; defaults to Date.now in production.
  now?: Date;
}): Promise<NotificationExpirySweepResult> {
  const now = args.now ?? new Date();
  try {
    const rows = await db
      .update(agentNotifications)
      .set({ undoableUntil: null })
      .where(
        and(
          isNotNull(agentNotifications.undoableUntil),
          lt(agentNotifications.undoableUntil, now),
        ),
      )
      .returning({ id: agentNotifications.id });
    return { expired: rows.length };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "agent_notifications", phase: "expiry_sweep" },
    });
    throw err;
  }
}
