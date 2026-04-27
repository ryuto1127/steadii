import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  type ActionOption,
} from "@/lib/db/schema";
import { recordProactiveFeedback } from "@/lib/agent/proactive/feedback-bias";
import { executeProactiveAction } from "@/lib/agent/proactive/action-executor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/agent/proposal/[id]/resolve  body: { actionKey }
// The user picked one of the proposal's actionOptions[]. We dispatch
// to the corresponding tool, mark the proposal resolved, and write a
// proactive-feedback row so future scanner LLM calls bias toward
// "user acts on this issue type".
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: proposalId } = await ctx.params;

  let body: { actionKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.actionKey !== "string") {
    return NextResponse.json(
      { error: "actionKey_required" },
      { status: 400 }
    );
  }
  const actionKey = body.actionKey;

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

  const option = (proposal.actionOptions as ActionOption[]).find(
    (o) => o.key === actionKey
  );
  if (!option) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  let executeResult: { redirectTo?: string } = {};
  try {
    executeResult = await executeProactiveAction({
      userId,
      option,
      proposal,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        feature: "proactive_resolve",
        actionKey,
        issueType: proposal.issueType,
      },
      user: { id: userId },
    });
    return NextResponse.json(
      {
        error: "action_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  await db
    .update(agentProposals)
    .set({
      status: "resolved",
      resolvedAction: actionKey,
      resolvedAt: new Date(),
      viewedAt: proposal.viewedAt ?? new Date(),
    })
    .where(eq(agentProposals.id, proposalId));

  // Acting (vs dismissing) on a proactive proposal is a positive
  // signal. Record it so the bias loop biases TOWARD this issue type.
  await recordProactiveFeedback({
    userId,
    issueType: proposal.issueType,
    userResponse: "sent",
    proposalId,
  });

  return NextResponse.json({
    ok: true,
    redirectTo: executeResult.redirectTo,
  });
}
