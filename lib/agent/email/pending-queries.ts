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
// AND that proposes an action only a human can confirm — draft_reply or
// ask_clarifying. archive/snooze/no_op/paused either auto-resolve or
// can't be moved by the user from the inbox list. The phase 7 polish PR
// added the inbox-list amber-dot marker and the sidebar count badge,
// both of which call through this helper so every surface aligns on the
// same definition.
export const PENDING_ACTIONS: ReadonlyArray<AgentDraftAction> = [
  "draft_reply",
  "ask_clarifying",
];

export function isPendingDraft(
  status: AgentDraftStatus | string | null | undefined,
  action: AgentDraftAction | string | null | undefined
): boolean {
  if (status !== "pending") return false;
  return (
    action === "draft_reply" || action === "ask_clarifying"
  );
}

// Comparator the inbox-list page feeds to Array.prototype.sort. Keeps the
// sort logic out of the page render so tests can prove pending-first
// ordering without mocking Drizzle.
export type InboxRowForSort = {
  receivedAt: Date;
  agentDraftStatus: AgentDraftStatus | string | null | undefined;
  agentDraftAction: AgentDraftAction | string | null | undefined;
};

export function compareInboxRows(
  a: InboxRowForSort,
  b: InboxRowForSort
): number {
  const ap = isPendingDraft(a.agentDraftStatus, a.agentDraftAction) ? 0 : 1;
  const bp = isPendingDraft(b.agentDraftStatus, b.agentDraftAction) ? 0 : 1;
  if (ap !== bp) return ap - bp;
  return b.receivedAt.getTime() - a.receivedAt.getTime();
}

export async function countPendingDrafts(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, PENDING_ACTIONS as AgentDraftAction[])
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
