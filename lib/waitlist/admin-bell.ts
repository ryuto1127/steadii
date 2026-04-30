import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentProposals, users } from "@/lib/db/schema";

// Admin-bell records for new waitlist requests. Reuses agent_proposals
// (issue_type='admin_waitlist_pending') so the same dismiss mechanic and
// per-user query path apply — no parallel notifications table required
// at α scale (admin count = 1).
//
// Lifecycle:
//   1. New request lands → recordWaitlistAdminNotification() inserts one
//      row per admin user, status='pending'.
//   2. Admin opens bell → loadWaitlistAdminPending() returns up to N
//      rows + a total count for the "+N more" overflow row.
//   3. Admin approves/denies → dismissWaitlistAdminNotifications() flips
//      status to 'dismissed' for ALL admin rows tied to that request.
//
// dedupKey shape: `admin_waitlist_pending:{waitlistRequestId}`. Per-row
// uniqueness is on (userId, dedupKey), so the same waitlist request can
// fan out to multiple admin users without conflict, and a re-trigger
// for the same admin no-ops via onConflictDoNothing.

export type WaitlistAdminBellItem = {
  id: string;
  summary: string;
  waitlistRequestId: string;
  createdAt: Date;
};

export function dedupKeyForWaitlistRequest(waitlistRequestId: string): string {
  return `admin_waitlist_pending:${waitlistRequestId}`;
}

export async function recordWaitlistAdminNotification(args: {
  waitlistRequestId: string;
  email: string;
  name: string | null;
  requestedAt: Date;
}): Promise<void> {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isAdmin, true));

  if (admins.length === 0) return;

  const summary = `New waitlist request from ${args.email}`;
  const reasoning = args.name
    ? `${args.email} (${args.name}) requested access on ${args.requestedAt.toISOString()}.`
    : `${args.email} requested access on ${args.requestedAt.toISOString()}.`;
  const dedupKey = dedupKeyForWaitlistRequest(args.waitlistRequestId);

  await db
    .insert(agentProposals)
    .values(
      admins.map((a) => ({
        userId: a.id,
        issueType: "admin_waitlist_pending" as const,
        issueSummary: summary,
        reasoning,
        sourceRefs: [
          {
            kind: "waitlist_request" as const,
            id: args.waitlistRequestId,
            label: args.email,
          },
        ],
        actionOptions: [],
        dedupKey,
      }))
    )
    // Idempotent: re-firing for the same (admin, request) is a no-op.
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    });
}

export async function dismissWaitlistAdminNotifications(
  waitlistRequestIds: string[]
): Promise<void> {
  if (waitlistRequestIds.length === 0) return;
  const dedupKeys = waitlistRequestIds.map(dedupKeyForWaitlistRequest);
  await db
    .update(agentProposals)
    .set({
      status: "dismissed",
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(agentProposals.issueType, "admin_waitlist_pending"),
        eq(agentProposals.status, "pending"),
        inArray(agentProposals.dedupKey, dedupKeys)
      )
    );
}

// Returns up to `limit` newest pending entries plus the total pending
// count, so the bell can render an "+N more" link when count > limit.
export async function loadWaitlistAdminPending(
  userId: string,
  limit: number = 5
): Promise<{ items: WaitlistAdminBellItem[]; total: number }> {
  const rows = await db
    .select({
      id: agentProposals.id,
      summary: agentProposals.issueSummary,
      sourceRefs: agentProposals.sourceRefs,
      createdAt: agentProposals.createdAt,
    })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        eq(agentProposals.issueType, "admin_waitlist_pending"),
        eq(agentProposals.status, "pending")
      )
    )
    .orderBy(desc(agentProposals.createdAt))
    .limit(limit);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        eq(agentProposals.issueType, "admin_waitlist_pending"),
        eq(agentProposals.status, "pending")
      )
    );

  const items: WaitlistAdminBellItem[] = rows.map((r) => {
    const ref = r.sourceRefs.find((x) => x.kind === "waitlist_request");
    return {
      id: r.id,
      summary: r.summary,
      waitlistRequestId: ref?.id ?? "",
      createdAt: r.createdAt,
    };
  });

  return { items, total: countRow?.n ?? items.length };
}
