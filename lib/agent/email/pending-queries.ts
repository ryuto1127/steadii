import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  type AgentDraftAction,
  type AgentDraftStatus,
} from "@/lib/db/schema";

// Shared queries used by the Home dashboard "Pending" card, the header
// notification bell, and anywhere else the count surfaces.

// One source of truth for "this draft is waiting on the user." A pending
// row is one the agent has finished thinking about (status='pending')
// AND that proposes an action only a human can confirm — draft_reply,
// ask_clarifying, or (polish-7) notify_only. archive/snooze/no_op/paused
// either auto-resolve or can't be moved by the user from the inbox list.
// notify_only is "important but no reply" — the user must still see it
// (so it sorts pending), but the detail page renders no draft form.
// The sidebar badge, notification bell, digest picker, and inbox-list
// typography all call through this helper so every surface aligns on
// the same definition.
export const PENDING_ACTIONS: ReadonlyArray<AgentDraftAction> = [
  "draft_reply",
  "ask_clarifying",
  "notify_only",
];

export function isPendingDraft(
  status: AgentDraftStatus | string | null | undefined,
  action: AgentDraftAction | string | null | undefined
): boolean {
  if (status !== "pending") return false;
  return (
    action === "draft_reply" ||
    action === "ask_clarifying" ||
    action === "notify_only"
  );
}

// Comparator the inbox-list page feeds to Array.prototype.sort. Keeps the
// sort logic out of the page render so tests can prove pending-first
// ordering without mocking Drizzle. polish-7 widens the group key from
// 2-state (pending/non-pending) to 3-state (pending → unread non-pending
// → read non-pending), with newest-first within each group. The
// reviewedAt field is treated as the read-state marker — set by the
// detail page on first open, mirrored from inbox_items.reviewed_at.
export type InboxRowForSort = {
  receivedAt: Date;
  agentDraftStatus: AgentDraftStatus | string | null | undefined;
  agentDraftAction: AgentDraftAction | string | null | undefined;
  reviewedAt?: Date | null;
};

function groupKey(row: InboxRowForSort): 0 | 1 | 2 {
  if (isPendingDraft(row.agentDraftStatus, row.agentDraftAction)) return 0;
  if (!row.reviewedAt) return 1;
  return 2;
}

export function compareInboxRows(
  a: InboxRowForSort,
  b: InboxRowForSort
): number {
  const ag = groupKey(a);
  const bg = groupKey(b);
  if (ag !== bg) return ag - bg;
  return b.receivedAt.getTime() - a.receivedAt.getTime();
}

// "Pending and not yet seen by the user" — the badge / digest count must
// drop the moment the user opens an inbox item's detail page (which sets
// inbox_items.reviewed_at), even before they act on it. Without the
// reviewedAt join the badge stayed pinned at the high-water mark and
// "vibes unread" forever; users complained items they'd already read
// kept screaming for attention. The list-view sort still surfaces
// reviewed-but-pending items at the top (compareInboxRows group 0), so
// nothing is forgotten — only the count and bold typography decay.
export async function countPendingDrafts(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, PENDING_ACTIONS as AgentDraftAction[]),
        sql`${inboxItems.reviewedAt} IS NULL`
      )
    );
  return row?.n ?? 0;
}

export type HighRiskPendingItem = {
  agentDraftId: string;
  inboxItemId: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  riskTier: "low" | "medium" | "high";
  receivedAt: Date;
};

// Top-N highest-risk pending drafts. Ordered by risk DESC then newest
// first. Used by the header notification bell popover.
export async function loadTopHighRiskPending(
  userId: string,
  limit: number = 5
): Promise<HighRiskPendingItem[]> {
  const rows = await db
    .select({
      agentDraftId: agentDrafts.id,
      inboxItemId: inboxItems.id,
      subject: inboxItems.subject,
      senderName: inboxItems.senderName,
      senderEmail: inboxItems.senderEmail,
      riskTier: agentDrafts.riskTier,
      receivedAt: inboxItems.receivedAt,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, PENDING_ACTIONS as AgentDraftAction[])
      )
    )
    .orderBy(desc(inboxItems.receivedAt))
    .limit(limit * 3);

  const ordered = [...rows].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    const ar = order[a.riskTier] ?? 3;
    const br = order[b.riskTier] ?? 3;
    if (ar !== br) return ar - br;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });

  return ordered.slice(0, limit).map((r) => ({
    agentDraftId: r.agentDraftId,
    inboxItemId: r.inboxItemId,
    subject: r.subject ?? "(no subject)",
    senderName: r.senderName ?? r.senderEmail,
    senderEmail: r.senderEmail,
    riskTier: r.riskTier,
    receivedAt: r.receivedAt,
  }));
}
