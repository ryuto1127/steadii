import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentIgnoredSenders,
  autoCreatedCalendarEvents,
  inboxItems,
  type AgentIgnoredSender,
  type IgnoredSenderSource,
} from "@/lib/db/schema";

// 今後この送信者を無視 — data-access layer for the per-user permanent
// sender ignore list. The L1 triage gate (lib/agent/email/rules.ts)
// consults `loadIgnoredSenderSet`; the queue server actions
// (app/app/queue-actions.ts) call the add/remove/list helpers.

// Normalize so the unique index can match. Mirrors the normalization in
// recordSenderEvent / setSenderRoleAction (trim + lowercase).
export function normalizeIgnoredSenderEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Bulk-load the user's ignored sender set for L1. Returns a Set of
// normalized lowercase emails so the classifier does an O(1) membership
// probe. Email-exact scope only (MVP) — domain-scoped rows, if ever
// written, are intentionally excluded here.
export async function loadIgnoredSenderSet(
  userId: string
): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ senderEmail: agentIgnoredSenders.senderEmail })
      .from(agentIgnoredSenders)
      .where(
        and(
          eq(agentIgnoredSenders.userId, userId),
          eq(agentIgnoredSenders.scope, "email")
        )
      );
    return new Set(rows.map((r) => r.senderEmail));
  } catch {
    // 2026-06-07 — schema-drift defense (SCHEMA_DRIFT_READ_ON_DEPLOY). This
    // is a hot-path read on EVERY email triage (buildUserContext). Prod
    // migrations are manual (feedback_prod_migration_manual), so in the
    // deploy→migrate window agent_ignored_senders may not exist yet — an
    // unguarded read throws "relation does not exist" and kills triage /
    // email ingest. Degrade to "no one ignored" (empty Set) instead of
    // crashing. Mirrors fetchPendingAutoCalRows in lib/agent/queue/build.ts.
    return new Set();
  }
}

// List for the settings reversibility surface. Sorted oldest-first so
// the list is stable across renders (createdAt asc).
export async function listIgnoredSenders(
  userId: string
): Promise<AgentIgnoredSender[]> {
  return db
    .select()
    .from(agentIgnoredSenders)
    .where(eq(agentIgnoredSenders.userId, userId))
    .orderBy(asc(agentIgnoredSenders.createdAt));
}

// Idempotent upsert of the (userId, senderEmail) ignore row. Returns true
// when a NEW row was inserted, false when it already existed (the unique
// constraint short-circuits via onConflictDoNothing). Empty/blank email
// is a no-op returning false.
export async function addIgnoredSender(args: {
  userId: string;
  senderEmail: string;
  source: IgnoredSenderSource;
}): Promise<boolean> {
  const senderEmail = normalizeIgnoredSenderEmail(args.senderEmail);
  if (!senderEmail) return false;
  const inserted = await db
    .insert(agentIgnoredSenders)
    .values({
      userId: args.userId,
      senderEmail,
      scope: "email",
      source: args.source,
    })
    .onConflictDoNothing({
      target: [agentIgnoredSenders.userId, agentIgnoredSenders.senderEmail],
    })
    .returning({ id: agentIgnoredSenders.id });
  return inserted.length > 0;
}

// Delete the ignore row (un-ignore). Hard delete — un-ignoring is a full
// reversal of intent, not a soft state. Returns true when a row was
// removed.
export async function removeIgnoredSender(args: {
  userId: string;
  senderEmail: string;
}): Promise<boolean> {
  const senderEmail = normalizeIgnoredSenderEmail(args.senderEmail);
  if (!senderEmail) return false;
  const deleted = await db
    .delete(agentIgnoredSenders)
    .where(
      and(
        eq(agentIgnoredSenders.userId, args.userId),
        eq(agentIgnoredSenders.senderEmail, senderEmail)
      )
    )
    .returning({ id: agentIgnoredSenders.id });
  return deleted.length > 0;
}

// Count the dismiss-signal history for a sender, used to gate the ≥2-
// dismiss "ignore this sender?" nudge.
//
// COUNTER-SOURCE DECISION (per handoff §4): the default queue dismiss
// (破棄) on an email card is a 24h SNOOZE — it routes through
// snoozeAgentDraftAction, which sets inbox_items.status='snoozed' but
// does NOT call recordSenderFeedback / recordSenderEvent. So
// sender_confidence.dismissedCount does NOT see the snooze path and is
// unreliable for this nudge. We instead count this sender's inbox_items
// in a dismiss-signal status ('snoozed' from the default dismiss +
// 'dismissed' from the permanent-dismiss path). This is the simplest
// reliable option and directly reflects "how many times has the user
// pushed this sender's mail off the queue."
//
// Case-insensitive match on sender_email (stored as-received) against the
// normalized lowercase key.
export async function countDismissSignalsForSender(args: {
  userId: string;
  senderEmail: string;
}): Promise<number> {
  const senderEmail = normalizeIgnoredSenderEmail(args.senderEmail);
  if (!senderEmail) return 0;
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, args.userId),
          eq(sql`lower(${inboxItems.senderEmail})`, senderEmail),
          inArray(inboxItems.status, ["snoozed", "dismissed"])
        )
      );
    return row?.count ?? 0;
  } catch {
    // 2026-06-07 — schema-drift defense (SCHEMA_DRIFT_READ_ON_DEPLOY). Runs
    // in the dismiss path (queueDismissAction). On any query failure return
    // 0 so a missing table degrades to "no ignore-offer" rather than a
    // thrown dismiss. Mirrors fetchPendingAutoCalRows in
    // lib/agent/queue/build.ts.
    return 0;
  }
}

// Whether the sender is already on the user's ignore list. Used to
// suppress the nudge (don't offer to ignore something already ignored).
export async function isSenderIgnored(args: {
  userId: string;
  senderEmail: string;
}): Promise<boolean> {
  const senderEmail = normalizeIgnoredSenderEmail(args.senderEmail);
  if (!senderEmail) return false;
  const [row] = await db
    .select({ id: agentIgnoredSenders.id })
    .from(agentIgnoredSenders)
    .where(
      and(
        eq(agentIgnoredSenders.userId, args.userId),
        eq(agentIgnoredSenders.senderEmail, senderEmail)
      )
    )
    .limit(1);
  return !!row;
}

// Retroactively clear everything currently surfaced from a sender so the
// queue empties immediately on ignore. Three side effects, all scoped to
// (userId, normalized senderEmail):
//   1. open/snoozed inbox_items → status='dismissed'
//   2. pending agent_drafts → disposition='ignored' (mirrors the Type B
//      無視中 permanent-dismiss disposition) + status='dismissed'
//   3. proposed/provisional auto_created_calendar_events whose inbox_item
//      is from this sender → status='cancelled'
//
// Returns the per-surface counts so the caller can audit-attribute the
// sweep. Only touches the named sender — never a sibling on the same
// domain. The sender match is case-insensitive (stored inbox sender_email
// is as-received; the ignore-list key is normalized lowercase).
export async function clearSurfacedFromSender(args: {
  userId: string;
  senderEmail: string;
}): Promise<{
  inboxDismissed: number;
  draftsIgnored: number;
  autoCalCancelled: number;
}> {
  const senderEmail = normalizeIgnoredSenderEmail(args.senderEmail);
  if (!senderEmail) {
    return { inboxDismissed: 0, draftsIgnored: 0, autoCalCancelled: 0 };
  }
  const now = new Date();

  // Resolve the matching inbox_item ids first. Drafts + auto-cal rows
  // don't carry their own sender column, so they're swept by their
  // inbox_item_id. The lower() comparison matches an uppercase-cased
  // stored address against the normalized ignore-list key.
  const matchRows = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        eq(sql`lower(${inboxItems.senderEmail})`, senderEmail)
      )
    );
  const inboxItemIds = matchRows.map((r) => r.id);
  if (inboxItemIds.length === 0) {
    return { inboxDismissed: 0, draftsIgnored: 0, autoCalCancelled: 0 };
  }

  // 1. Dismiss the open/snoozed inbox rows from this sender.
  const dismissed = await db
    .update(inboxItems)
    .set({ status: "dismissed", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        inArray(inboxItems.id, inboxItemIds),
        inArray(inboxItems.status, ["open", "snoozed"])
      )
    )
    .returning({ id: inboxItems.id });

  // 2. Terminal-ignore the pending drafts tied to those inbox items.
  //    Reuses the existing permanent-dismiss disposition ('ignored')
  //    rather than reinventing a disposition; also flips the legacy
  //    status field to 'dismissed' so any status-keyed reader drops it.
  const drafts = await db
    .update(agentDrafts)
    .set({
      disposition: "ignored",
      status: "dismissed",
      updatedAt: now,
    })
    .where(
      and(
        eq(agentDrafts.userId, args.userId),
        inArray(agentDrafts.inboxItemId, inboxItemIds),
        eq(agentDrafts.status, "pending")
      )
    )
    .returning({ id: agentDrafts.id });

  // 3. Cancel any proposed/provisional auto-cal rows tied to those inbox
  //    items (the fake-deadline / fake-meeting proposals).
  const autoCal = await db
    .update(autoCreatedCalendarEvents)
    .set({ status: "cancelled", cancelledAt: now })
    .where(
      and(
        eq(autoCreatedCalendarEvents.userId, args.userId),
        inArray(autoCreatedCalendarEvents.inboxItemId, inboxItemIds),
        inArray(autoCreatedCalendarEvents.status, ["proposed", "provisional"])
      )
    )
    .returning({ id: autoCreatedCalendarEvents.id });

  return {
    inboxDismissed: dismissed.length,
    draftsIgnored: drafts.length,
    autoCalCancelled: autoCal.length,
  };
}
