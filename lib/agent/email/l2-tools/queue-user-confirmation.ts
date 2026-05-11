import "server-only";
import { db } from "@/lib/db/client";
import {
  agentConfirmations,
  type NewAgentConfirmation,
} from "@/lib/db/schema";
import type { L2ToolExecutor } from "./types";

// engineer-41 — queue a question for the user.
//
// The agentic L2 loop is allowed to surface a question instead of guessing
// when an inference is uncertain (e.g. "is this contact in JST?"). The
// tool writes a row to agent_confirmations with status='pending'.
// Engineer-42 builds the Type F card that renders these and provides the
// resolve flow. The loop does NOT block — it returns the row id and
// continues with its best-guess inferred value.

export type QueueUserConfirmationArgs = {
  topic: string;
  question: string;
  inferredValue?: string | null;
  options?: string[] | null;
  senderEmail?: string | null;
  context?: Record<string, unknown> | null;
};

export type QueueUserConfirmationResult = {
  confirmationId: string;
  status: "queued";
};

export const queueUserConfirmationTool: L2ToolExecutor<
  QueueUserConfirmationArgs,
  QueueUserConfirmationResult
> = {
  schema: {
    name: "queue_user_confirmation",
    description:
      "Queue a question for the user to resolve later (NOT a blocking question). Use when an inference is uncertain enough that the user should review it but not urgent enough to halt the loop — Steadii will continue with its best-guess inferred value and surface the question in a Type F card. Topics: 'timezone', 'sender_role', 'language_preference', 'meeting_format'. Always supply an `inferredValue` so the user sees what Steadii is going to use unless they correct it.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", minLength: 1, maxLength: 80 },
        question: { type: "string", minLength: 3, maxLength: 500 },
        inferredValue: { type: ["string", "null"] },
        options: {
          type: ["array", "null"],
          items: { type: "string", minLength: 1, maxLength: 200 },
          maxItems: 8,
        },
        senderEmail: { type: ["string", "null"] },
        context: {
          type: ["object", "null"],
          additionalProperties: true,
        },
      },
      required: ["topic", "question"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const row: NewAgentConfirmation = {
      userId: ctx.userId,
      topic: args.topic.trim().slice(0, 80),
      senderEmail: args.senderEmail?.trim()?.toLowerCase() ?? null,
      question: args.question.trim(),
      inferredValue: args.inferredValue?.trim() ?? null,
      options: args.options && args.options.length > 0 ? args.options : null,
      status: "pending",
      context: args.context ?? null,
    };
    const [inserted] = await db
      .insert(agentConfirmations)
      .values(row)
      .returning({ id: agentConfirmations.id });
    return {
      confirmationId: inserted.id,
      status: "queued" as const,
    };
  },
};
