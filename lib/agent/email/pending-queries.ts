import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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

// Narrower set than PENDING_ACTIONS — only items that REQUIRE the user
// to do something (send a reply, or provide clarifying info). The Inbox
// "Action needed" filter chip + future digest-narrowing flows use this.
// notify_only is excluded because it's a "FYI, you should know but no
// reply expected" category — important but not action-blocking.
export const ACTION_NEEDED_ACTIONS: ReadonlyArray<AgentDraftAction> = [
  "draft_reply",
  "ask_clarifying",
];

// 2026-05-05 — Ryuto's policy refined: the sidebar / bell / inbox
// "action-needed" filter is STRICT — only drafts that genuinely
// require the user to act (draft_reply / ask_clarifying). The earlier
// version of this clause (PR #158) widened to also include
// notify_only-on-auto_high informational items, but Ryuto pointed
// out that legacy mis-classifications (Stripe / AMD verification /
// Vercel deploy notifications all stuck at 高/重要 from before the
// engineer-32 GitHub-aware routing landed) drowned the signal —
// "5 件と表示されていながら、actionのものが0". Strict it is.
//
// notify_only items still surface via /app/inbox?view=all; they're
// not lost, just not contributing to the action count.
export function attentionDraftClause() {
  return and(
    inArray(agentDrafts.action, ACTION_NEEDED_ACTIONS as AgentDraftAction[]),
    inArray(agentDrafts.status, ["pending", "edited"])
  );
}

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
  // 2026-05-05 strategic shift (refined later same day) — the sidebar
  // badge counts items that need user attention per the
  // "重要 or action 必要" policy. attentionDraftClause covers both
  // (1) draft_reply / ask_clarifying drafts, AND
  // (2) notify_only drafts on auto_high bucket (important informational
  //     — Stripe action-required portal, billing alerts, etc.).
  // Aligned with /app/inbox default view + bell popover so the three
  // surfaces never drift.
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(inboxItems.status, "open"),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.bucket, "ignore"),
        sql`${inboxItems.reviewedAt} IS NULL`,
        attentionDraftClause()
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
        eq(inboxItems.status, "open"),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.bucket, "ignore"),
        // 2026-05-05 strategic shift — bell popover surfaces both
        // action-needed AND high-risk informational items, in lockstep
        // with countPendingDrafts and inbox default view.
        attentionDraftClause()
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
