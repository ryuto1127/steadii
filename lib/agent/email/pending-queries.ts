import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems } from "@/lib/db/schema";

// Shared queries used by the Home dashboard "Pending" card, the header
// notification bell, and anywhere else the count surfaces.

export async function countPendingDrafts(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, ["draft_reply", "ask_clarifying"])
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
        inArray(agentDrafts.action, ["draft_reply", "ask_clarifying"])
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
