import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { agentProposals } from "@/lib/db/schema";
import { recordProactiveFeedback } from "@/lib/agent/proactive/feedback-bias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/agent/proposal/[id]/dismiss
// Marks the proposal dismissed, records the dismissal in the polish-7
// feedback table per D6 so the scanner LLM biases away from this
// issue type next time, and clears the dedup row's "pending" hold so
// a re-detection after the 24h window can re-surface (D2).
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: proposalId } = await ctx.params;

  const [proposal] = await db
    .select()
    .from(agentProposals)
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    )
    .limit(1);
  if (!proposal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: "already_resolved", status: proposal.status },
      { status: 409 }
    );
  }

  await db
    .update(agentProposals)
    .set({
      status: "dismissed",
      resolvedAction: "dismissed",
      resolvedAt: new Date(),
      viewedAt: proposal.viewedAt ?? new Date(),
    })
    .where(eq(agentProposals.id, proposalId));

  await recordProactiveFeedback({
    userId,
    issueType: proposal.issueType,
    userResponse: "dismissed",
    proposalId,
  });

  return NextResponse.json({ ok: true });
}
