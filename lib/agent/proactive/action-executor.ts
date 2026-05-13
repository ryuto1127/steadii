import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditLog,
  chats,
  messages as messagesTable,
  userFacts,
  users,
  type ActionOption,
  type AgentProposalRow,
} from "@/lib/db/schema";
import { lifecycleForCategory } from "@/lib/agent/user-facts-lifecycle";

// Maps a proactive ActionOption → side-effect.
//
// Most actions don't actually mutate Google services from this server
// path; they prepare a follow-up surface (chat seeded with context,
// task draft, email draft) so the user lands in the existing
// confirmation flow. The narrow exception is `dismiss`, which the
// dedicated /dismiss route handles before this executor sees it.
//
// Returning `redirectTo` tells the UI where to send the user after
// the resolve POST returns 200 — used by chat_followup.

export type ActionExecutionResult = {
  redirectTo?: string;
};

export async function executeProactiveAction(args: {
  userId: string;
  option: ActionOption;
  proposal: AgentProposalRow;
}): Promise<ActionExecutionResult> {
  const { option, userId, proposal } = args;

  // engineer-48 — user_fact_review uses tool='auto' with a payload-driven
  // op so confirm/delete run inline (no follow-up chat). edit routes
  // through chat_followup but the underlying action is "open settings"
  // — we handle that there too so the deep link points to the right
  // surface.
  if (proposal.issueType === "user_fact_review") {
    return await resolveUserFactReview(userId, option);
  }

  // engineer-49 — monthly check-in: stamp the lastMonthlyReviewAt
  // preference (so the rule short-circuits for the next 30 days) and
  // redirect to the tuning page when the user picked "review."
  if (proposal.issueType === "monthly_boundary_review") {
    await stampLastMonthlyReviewAt(userId);
    const href =
      typeof option.payload?.href === "string"
        ? (option.payload.href as string)
        : null;
    return href ? { redirectTo: href } : {};
  }

  switch (option.tool) {
    case "chat_followup":
      return await spawnFollowupChat(userId, option, proposal);
    case "email_professor":
    case "reschedule_event":
    case "delete_event":
    case "create_task":
    case "add_mistake_note":
    case "link_existing":
    case "add_anyway":
      // PR 3 lands the resolution-tracking + feedback loop. Wiring
      // these into the existing tool executors (Gmail send, Calendar
      // patch, etc.) lives in PR 4 next to the chat-aware suggestion
      // surface — same routing, same confirmation flow. For now:
      // mark resolved and surface a chat_followup-style breadcrumb
      // so the user can finish via the chat tool.
      return await spawnFollowupChat(userId, option, proposal);
    case "auto":
      // D11 informational entry — viewing IS the resolution.
      return {};
    case "dismiss":
      // Handled by /dismiss route. Should never reach here.
      return {};
  }
}

// engineer-49 — Postgres jsonb merge so we don't clobber other
// preferences keys when stamping lastMonthlyReviewAt. Failure is
// swallowed: the worst case is the rule re-fires on the next scan,
// which is recoverable.
export async function stampLastMonthlyReviewAt(userId: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await db
      .update(users)
      .set({
        preferences: sql`COALESCE(${users.preferences}, '{}'::jsonb) || ${JSON.stringify(
          { lastMonthlyReviewAt: nowIso }
        )}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch {
    // Best-effort; the next scan will re-evaluate cadence.
  }
}

// engineer-48 — inline confirm / delete / edit for user_fact_review.
async function resolveUserFactReview(
  userId: string,
  option: ActionOption
): Promise<ActionExecutionResult> {
  const factId =
    typeof option.payload?.factId === "string"
      ? (option.payload.factId as string)
      : null;
  const op =
    typeof option.payload?.op === "string"
      ? (option.payload.op as string)
      : option.key;
  if (!factId) return {};

  const [existing] = await db
    .select({
      id: userFacts.id,
      category: userFacts.category,
    })
    .from(userFacts)
    .where(
      and(
        eq(userFacts.id, factId),
        eq(userFacts.userId, userId),
        isNull(userFacts.deletedAt)
      )
    )
    .limit(1);
  if (!existing) return {};

  const now = new Date();
  if (op === "confirm") {
    const lifecycle = lifecycleForCategory(existing.category, now);
    await db
      .update(userFacts)
      .set({
        reviewedAt: now,
        lastUsedAt: now,
        expiresAt: lifecycle.expiresAt,
        nextReviewAt: lifecycle.nextReviewAt,
        decayHalfLifeDays: lifecycle.decayHalfLifeDays,
      })
      .where(eq(userFacts.id, factId));
    await db.insert(auditLog).values({
      userId,
      action: "user_fact_reconfirmed",
      resourceType: "user_fact",
      resourceId: factId,
      result: "success",
      detail: { via: "queue_confirm" },
    });
    return {};
  }
  if (op === "delete") {
    await db
      .update(userFacts)
      .set({ deletedAt: now })
      .where(eq(userFacts.id, factId));
    await db.insert(auditLog).values({
      userId,
      action: "user_fact_deleted",
      resourceType: "user_fact",
      resourceId: factId,
      result: "success",
      detail: { via: "queue_review" },
    });
    return {};
  }
  // edit → take the user to the settings page so they can re-write the
  // fact inline. The proposal's resolvedAt stamp gets written by the
  // caller after this returns.
  return { redirectTo: "/app/settings/facts" };
}

// Open a chat seeded with the proposal context. The user can iterate
// on the suggestion (e.g., have the agent draft the email or move the
// event) using the existing chat tools, all of which honor the
// confirmation flow per D5.
async function spawnFollowupChat(
  userId: string,
  option: ActionOption,
  proposal: AgentProposalRow
): Promise<ActionExecutionResult> {
  const seed =
    typeof option.payload?.seedMessage === "string"
      ? (option.payload.seedMessage as string)
      : `Steadii noticed: ${proposal.issueSummary}\n\n${proposal.reasoning}\n\nNext step: ${option.label}`;

  const [chatRow] = await db
    .insert(chats)
    .values({
      userId,
      title: proposal.issueSummary.slice(0, 80),
    })
    .returning({ id: chats.id });

  await db.insert(messagesTable).values({
    chatId: chatRow.id,
    role: "user",
    content: seed,
  });

  // `?stream=1` triggers the chat-view auto-stream on mount. Without it,
  // the seeded user message renders but the assistant turn never starts —
  // user lands on an empty-looking chat. See chat-view.tsx auto-trigger.
  return { redirectTo: `/app/chat/${chatRow.id}?stream=1` };
}
