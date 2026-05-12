import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, chats } from "@/lib/db/schema";
import { logEmailAudit } from "@/lib/agent/email/audit";
import type { ToolExecutor } from "./types";

// engineer-46 — chat-driven Type E resolution effector.
//
// Closes a clarification chat by (a) inserting a new agent_drafts row
// with the resolved action/body/subject/to/cc + the agent's natural-
// language reasoning, and (b) flipping the original ask_clarifying
// draft to dismissed. Both writes run in a single transaction so a
// partial failure can never leave the queue with two rows that point
// at the same email.
//
// Availability: registered globally but the chat orchestrator only
// exposes it to the model when the chat session has a non-null
// clarifyingDraftId. See lib/agent/tool-registry.ts for the gating.
//
// The "reasoning" field is glass-box transparency — same rules as the
// agentic L2 prompt: NEVER include internal tool function names. The
// student reads this; engineers do not.

const args = z.object({
  // Threaded via session context but accepted as input for explicit
  // tool-call traceability and so a test can drive it without seeding
  // chat state. Validated against the chat's clarifyingDraftId.
  originalDraftId: z.string().uuid(),
  newAction: z.enum(["draft_reply", "ask_clarifying", "notify_only", "no_op"]),
  draftBody: z.string().min(1).max(20000),
  draftSubject: z.string().min(1).max(500),
  draftTo: z.array(z.string().email()).min(1).max(10),
  draftCc: z.array(z.string().email()).max(10).default([]),
  reasoning: z.string().min(1).max(2000),
});

export type ResolveClarificationArgs = z.infer<typeof args>;

export type ResolveClarificationResult = {
  newDraftId: string;
  status: "resolved";
};

// Forbidden tokens — the reasoning surfaces in /app/inbox/<id> as
// glass-box transparency, the same surface the agentic L2 reasoning
// uses. Internal tool names must never leak. Mirrors the L2 system
// prompt's forbidden-list (agentic-l2-prompt.ts:27).
const FORBIDDEN_REASONING_TOKENS = [
  "lookup_contact_persona",
  "extract_candidate_dates",
  "infer_sender_timezone",
  "check_availability",
  "detect_ambiguity",
  "queue_user_confirmation",
  "write_draft",
  "resolve_clarification",
  "convert_timezone",
];

function assertReasoningClean(reasoning: string): void {
  const lower = reasoning.toLowerCase();
  for (const token of FORBIDDEN_REASONING_TOKENS) {
    if (lower.includes(token)) {
      throw new Error(
        `Reasoning leaks internal tool name "${token}"; rewrite in plain language.`
      );
    }
  }
}

export const resolveClarification: ToolExecutor<
  ResolveClarificationArgs,
  ResolveClarificationResult
> = {
  schema: {
    name: "resolve_clarification",
    description:
      "Finalize a clarification chat by creating a new email draft and closing the original ask_clarifying card. Call this only after you've gathered enough info from the student AND called write_draft (or composed the body yourself) — the chat thread itself becomes the audit trail for how the answer was reached. Inputs: originalDraftId (the agent_drafts row the chat was opened from), newAction (usually draft_reply), the resolved draftBody / draftSubject / draftTo / draftCc, and a short reasoning string in the student's locale. Reasoning MUST be in plain student-facing language — internal tool function names are forbidden.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        originalDraftId: {
          type: "string",
          description:
            "UUID of the original agent_drafts row whose action='ask_clarifying'.",
        },
        newAction: {
          type: "string",
          enum: ["draft_reply", "ask_clarifying", "notify_only", "no_op"],
          description: "Resolved action — usually 'draft_reply' by this point.",
        },
        draftBody: {
          type: "string",
          description:
            "The composed reply body. Should already include dual-TZ slot strings where appropriate (use the strings returned by convert_timezone verbatim).",
        },
        draftSubject: { type: "string" },
        draftTo: {
          type: "array",
          items: { type: "string" },
          description: "Recipient(s) — usually the original sender.",
        },
        draftCc: {
          type: "array",
          items: { type: "string" },
        },
        reasoning: {
          type: "string",
          description:
            "2-4 sentence student-facing summary of what got resolved. Internal tool names are forbidden — describe WHAT you verified, not which functions you called.",
        },
      },
      required: [
        "originalDraftId",
        "newAction",
        "draftBody",
        "draftSubject",
        "draftTo",
        "reasoning",
      ],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    assertReasoningClean(parsed.reasoning);

    // Load the original draft and validate ownership + state. We do
    // this outside the transaction so the auth check fails fast and
    // doesn't enter Drizzle's TX engine on a no-op.
    const [original] = await db
      .select()
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.id, parsed.originalDraftId),
          eq(agentDrafts.userId, ctx.userId)
        )
      )
      .limit(1);
    if (!original) {
      throw new Error("Original draft not found or not owned by user.");
    }
    if (original.action !== "ask_clarifying") {
      throw new Error(
        `Original draft action is "${original.action}", not "ask_clarifying" — cannot resolve.`
      );
    }
    if (original.status !== "pending") {
      throw new Error(
        `Original draft status is "${original.status}", not "pending" — already resolved.`
      );
    }

    // Transaction: insert the resolved draft + dismiss the original.
    // Both rows point at the same inbox_item so the queue's draft
    // listing only ever shows the live one (status='pending').
    const newDraftId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(agentDrafts)
        .values({
          userId: ctx.userId,
          inboxItemId: original.inboxItemId,
          // Carry the model attribution from the original so audit /
          // cost reporting attributes correctly. Risk tier is reused
          // because the underlying email risk hasn't changed; only
          // the resolution path differed.
          classifyModel: original.classifyModel,
          draftModel: original.draftModel,
          riskTier: original.riskTier,
          action: parsed.newAction,
          reasoning: parsed.reasoning,
          draftSubject: parsed.draftSubject,
          draftBody: parsed.draftBody,
          originalDraftBody: parsed.draftBody,
          draftTo: parsed.draftTo,
          draftCc: parsed.draftCc,
          status: "pending",
        })
        .returning({ id: agentDrafts.id });

      await tx
        .update(agentDrafts)
        .set({ status: "dismissed", updatedAt: new Date() })
        .where(eq(agentDrafts.id, parsed.originalDraftId));

      return inserted.id;
    });

    // Audit row sits outside the TX — best-effort, never blocks the
    // resolution. The chat row itself is the canonical record of what
    // got asked + answered.
    await logEmailAudit({
      userId: ctx.userId,
      action: "email_l2_completed",
      result: "success",
      resourceId: newDraftId,
      detail: {
        subAction: "clarification_resolved_via_chat",
        originalDraftId: parsed.originalDraftId,
        newAction: parsed.newAction,
      },
    });

    // Flip the chat row's clarifyingDraftId to null so the tool
    // doesn't keep getting offered after the resolve has fired. Cheap
    // safeguard against a model that re-invokes the same call twice
    // in one chat. Best-effort: we look up the chat id by the draft
    // id reverse-link, which the tool context doesn't directly carry.
    // The orchestrator could pass chatId in ctx but the public
    // ToolExecutionContext shape is { userId } today; widening that
    // surface for a single tool isn't worth it.
    await db
      .update(chats)
      .set({ clarifyingDraftId: null, updatedAt: new Date() })
      .where(
        and(
          eq(chats.userId, ctx.userId),
          eq(chats.clarifyingDraftId, parsed.originalDraftId)
        )
      );

    return { newDraftId, status: "resolved" };
  },
};

export const RESOLVE_CLARIFICATION_TOOLS = [resolveClarification];
