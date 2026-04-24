import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { RetrievalProvenance } from "@/lib/db/schema";
import type { SimilarEmail } from "./retrieval";
import type { RiskPassResult } from "./classify-risk";

export type DeepAction =
  | "draft_reply"
  | "archive"
  | "snooze"
  | "no_op"
  | "ask_clarifying";

export type DeepPassInput = {
  userId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  snippet: string | null;
  bodySnippet: string | null;
  riskPass: RiskPassResult;
  similarEmails: SimilarEmail[];
  totalCandidates: number;
  threadRecentMessages: Array<{ sender: string; snippet: string }>; // last 2 thread predecessors
};

export type DeepPassResult = {
  action: DeepAction;
  reasoning: string;
  retrievalProvenance: RetrievalProvenance;
  usageId: string | null;
};

const SYSTEM_PROMPT = `You are Steadii's deep classifier for high-risk emails. You receive:
- the email envelope + snippet
- the cheap risk-pass output (tier + its reasoning)
- up to 20 retrieved similar past emails (subject + snippet + sender)
- the immediately prior 2 messages in the same thread (if any)

Decide the action the agent should take:
- draft_reply: compose a reply for the user to review.
- archive: no action needed (receipt/confirmation-only email).
- snooze: reply is needed but not now (user needs more info / wait on deadline).
- no_op: dismiss; not actually actionable.
- ask_clarifying: the email itself is ambiguous and the user must answer a question before a reply can be drafted.

Default to draft_reply when the sender is asking for something and enough context exists. Default to ask_clarifying when the needed decision is the user's to make. Never choose archive for high-risk items that reference grades, transcripts, supervisors, or admissions unless the email is strictly a receipt.

Reasoning must cite at least one retrieved similar email by subject when applicable — glass-box transparency is a hard product requirement.`;

const DEEP_PASS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["draft_reply", "archive", "snooze", "no_op", "ask_clarifying"],
    },
    reasoning: { type: "string", minLength: 1, maxLength: 1500 },
  },
  required: ["action", "reasoning"],
} as const;

export async function runDeepPass(
  input: DeepPassInput
): Promise<DeepPassResult> {
  return Sentry.startSpan(
    {
      name: "email.l2.deep_pass",
      op: "gen_ai.classify",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.task_type": "email_classify_deep",
        "steadii.retrieval.returned": input.similarEmails.length,
      },
    },
    async () => {
      const model = selectModel("email_classify_deep");
      const userContent = buildUserContent(input);

      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "deep_pass",
            strict: true,
            schema: DEEP_PASS_JSON_SCHEMA,
          },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "email_classify_deep",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
            ?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const parsed = parseDeepPassOutput(
        resp.choices[0]?.message?.content ?? "{}"
      );
      const retrievalProvenance = buildProvenance(input);

      return {
        action: parsed.action,
        reasoning: parsed.reasoning,
        retrievalProvenance,
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDeepPassOutput(raw: string): {
  action: DeepAction;
  reasoning: string;
} {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const validActions: DeepAction[] = [
    "draft_reply",
    "archive",
    "snooze",
    "no_op",
    "ask_clarifying",
  ];
  const action: DeepAction = validActions.includes(o.action as DeepAction)
    ? (o.action as DeepAction)
    : "ask_clarifying"; // safety default: surface to user, don't silently archive
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning
      : "Model output was unparseable; deferring to user review.";
  return { action, reasoning };
}

function buildUserContent(input: DeepPassInput): string {
  const parts: string[] = [];
  parts.push("=== Current email ===");
  parts.push(`From: ${input.senderEmail} (${input.senderDomain})`);
  if (input.senderRole) parts.push(`Sender role: ${input.senderRole}`);
  parts.push(`Subject: ${input.subject ?? "(none)"}`);
  parts.push(`Body: ${(input.bodySnippet ?? input.snippet ?? "").slice(0, 2000)}`);

  parts.push("\n=== Risk-pass output ===");
  parts.push(`Tier: ${input.riskPass.riskTier} (confidence ${input.riskPass.confidence.toFixed(2)})`);
  parts.push(`Reasoning: ${input.riskPass.reasoning}`);

  if (input.threadRecentMessages.length > 0) {
    parts.push("\n=== Last messages in thread (oldest first) ===");
    for (const m of input.threadRecentMessages) {
      parts.push(`- From ${m.sender}: ${m.snippet.slice(0, 400)}`);
    }
  }

  parts.push(
    `\n=== Retrieved similar emails (top ${input.similarEmails.length} of ${input.totalCandidates}) ===`
  );
  if (input.similarEmails.length === 0) {
    parts.push("(none — user's corpus is new or no semantic matches)");
  } else {
    input.similarEmails.forEach((e, i) => {
      parts.push(
        `${i + 1}. [sim=${e.similarity.toFixed(
          2
        )}] ${e.senderEmail} — ${e.subject ?? "(no subject)"} — ${
          (e.snippet ?? "").slice(0, 160)
        }`
      );
    });
  }

  return parts.join("\n");
}

export function buildProvenance(
  input: Pick<DeepPassInput, "similarEmails" | "totalCandidates">
): RetrievalProvenance {
  return {
    sources: input.similarEmails.map((e) => ({
      type: "email" as const,
      id: e.inboxItemId,
      similarity: e.similarity,
      snippet: (e.snippet ?? e.subject ?? "").slice(0, 200),
    })),
    total_candidates: input.totalCandidates,
    returned: input.similarEmails.length,
  };
}
