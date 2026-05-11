import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type {
  ExtractedActionItem,
  RetrievalProvenance,
} from "@/lib/db/schema";
import type { RiskPassResult } from "./classify-risk";
import { logEmailAudit } from "./audit";
import { getL2ToolByName, l2OpenAIToolDefs } from "./l2-tools";
import {
  AGENTIC_L2_SYSTEM_PROMPT,
  AGENTIC_L2_FINAL_SCHEMA,
  buildAgenticL2UserMessage,
} from "./agentic-l2-prompt";
import type { DeepAction } from "./classify-deep";
import type OpenAI from "openai";

// engineer-41 — Agentic L2 orchestrator. Mirrors lib/agent/orchestrator.ts
// (chat tool-using loop) but trimmed for email reasoning: no
// confirmation gates (the loop runs inside the L2 pipeline, not on
// behalf of a chat user), no persisted-message tracking (the result is
// returned as a structured object), no streaming surface to the
// browser. Iteration cap and forced final-pass behavior are identical.

const MAX_TOOL_ITERATIONS = 10;
const MIN_USEFUL_FINAL_TEXT_LENGTH = 20;

export type InferredFact = {
  topic: string;
  value: string;
  confidence: number;
  source: string;
};

export type ConfirmationQuestion = {
  confirmationId: string;
  topic: string;
  question: string;
};

export type AvailabilityCheckLog = {
  slotIso: string;
};

export type AgenticL2Input = {
  userId: string;
  inboxItemId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  bodyForPipeline: string;
  riskPass: RiskPassResult;
  locale: "en" | "ja";
};

export type AgenticL2Result = {
  action: DeepAction;
  reasoning: string;
  actionItems: ExtractedActionItem[];
  retrievalProvenance: RetrievalProvenance | null;
  usageId: string | null;

  // New surfaces specific to agentic L2.
  confirmationQuestions: ConfirmationQuestion[];
  inferredFacts: InferredFact[];
  availabilityChecks: AvailabilityCheckLog[];
  schedulingDetected: boolean;

  // Bookkeeping the wrapping pipeline reuses (cost observation logs).
  iterations: number;
  toolCallCount: number;
};

export async function runAgenticL2(
  input: AgenticL2Input
): Promise<AgenticL2Result> {
  return Sentry.startSpan(
    {
      name: "email.l2.agentic_pipeline",
      op: "gen_ai.pipeline",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.inbox_item_id": input.inboxItemId,
        "steadii.task_type": "email_classify_deep",
      },
    },
    async () => runLoop(input)
  );
}

async function runLoop(input: AgenticL2Input): Promise<AgenticL2Result> {
  const model = selectModel("email_classify_deep");
  const userMsg = buildAgenticL2UserMessage({
    locale: input.locale,
    senderEmail: input.senderEmail,
    senderDomain: input.senderDomain,
    senderRole: input.senderRole,
    subject: input.subject,
    body: input.bodyForPipeline,
    riskTierReasoning: `Risk pass tier=${input.riskPass.riskTier} (confidence ${input.riskPass.confidence.toFixed(2)}). ${input.riskPass.reasoning}`,
  });

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: AGENTIC_L2_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ];

  const confirmationsQueued: ConfirmationQuestion[] = [];
  const availabilityChecks: AvailabilityCheckLog[] = [];
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;

  let iterations = 0;
  let finalText = "";

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;

    let text = "";
    let toolCalls: Array<{ id: string; name: string; args: string }> = [];

    try {
      const stream = await openai().chat.completions.create({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: conversation,
        tools: l2OpenAIToolDefs(),
        tool_choice: "auto",
      });

      const partialToolCalls: Record<
        number,
        { id: string; name: string; args: string }
      > = {};

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) text += delta.content;
        const deltaToolCalls = delta?.tool_calls;
        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const idx = tc.index ?? 0;
            if (!partialToolCalls[idx]) {
              partialToolCalls[idx] = {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                args: tc.function?.arguments ?? "",
              };
            } else {
              if (tc.id) partialToolCalls[idx].id = tc.id;
              if (tc.function?.name)
                partialToolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments)
                partialToolCalls[idx].args += tc.function.arguments;
            }
          }
        }
        if (chunk.usage) {
          totalInputTokens += chunk.usage.prompt_tokens ?? 0;
          totalOutputTokens += chunk.usage.completion_tokens ?? 0;
          const cacheInfo = (chunk.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          }).prompt_tokens_details;
          totalCachedTokens += cacheInfo?.cached_tokens ?? 0;
        }
      }
      toolCalls = Object.values(partialToolCalls).filter(
        (c) => c.id && c.name
      );
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "agentic_l2", step: "loop_stream" },
        user: { id: input.userId },
      });
      throw err;
    }

    finalText = text;

    if (toolCalls.length === 0) {
      // The model is done with tool use. Treat this iteration's text as
      // the candidate final-pass JSON.
      break;
    }

    conversation.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const call of toolCalls) {
      toolCallCount += 1;
      const tool = getL2ToolByName(call.name);
      if (!tool) {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "unknown_tool", name: call.name }),
        });
        continue;
      }
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(call.args || "{}");
      } catch {
        parsedArgs = {};
      }
      let result: unknown;
      try {
        result = await tool.execute(
          { userId: input.userId, inboxItemId: input.inboxItemId },
          parsedArgs
        );
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            feature: "agentic_l2",
            step: "tool_execute",
            tool: call.name,
          },
          user: { id: input.userId },
        });
        result = {
          error: "tool_failed",
          message: err instanceof Error ? err.message : "tool_failed",
        };
      }
      // Side-channel bookkeeping: capture confirmation rows + availability
      // check inputs as they happen so the orchestrator's caller sees them
      // even when the LLM forgets to list them in its final JSON.
      if (
        call.name === "queue_user_confirmation" &&
        result &&
        typeof result === "object"
      ) {
        const r = result as { confirmationId?: unknown };
        if (typeof r.confirmationId === "string") {
          // Best-effort topic / question grab from the args.
          const args = parsedArgs as {
            topic?: unknown;
            question?: unknown;
          } | null;
          confirmationsQueued.push({
            confirmationId: r.confirmationId,
            topic:
              typeof args?.topic === "string" ? args.topic : "unknown",
            question:
              typeof args?.question === "string" ? args.question : "",
          });
        }
      }
      if (call.name === "check_availability") {
        const args = parsedArgs as {
          slots?: Array<{ start?: string }>;
        } | null;
        if (Array.isArray(args?.slots)) {
          for (const s of args.slots) {
            if (typeof s?.start === "string") {
              availabilityChecks.push({ slotIso: s.start });
            }
          }
        }
      }
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Forced final-pass safety net — orchestrator.ts pattern. The model
  // might have exhausted its tool budget without ever emitting the
  // structured JSON. Run one tool-disabled completion with json_schema
  // to coerce a result we can persist.
  const needForcedPass =
    finalText.trim().length < MIN_USEFUL_FINAL_TEXT_LENGTH ||
    !looksLikeJsonObject(finalText);

  let parsedFinal: Awaited<ReturnType<typeof emitFinalPass>> | null = null;
  if (needForcedPass) {
    parsedFinal = await emitFinalPass({
      model,
      conversation,
      onUsage: (u) => {
        totalInputTokens += u.input;
        totalOutputTokens += u.output;
        totalCachedTokens += u.cached;
      },
    });
  } else {
    parsedFinal = parseFinalJson(finalText);
  }

  const rec = await recordUsage({
    userId: input.userId,
    model,
    taskType: "email_classify_deep",
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cachedTokens: totalCachedTokens,
  });

  await logEmailAudit({
    userId: input.userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: input.inboxItemId,
    detail: {
      mode: "agentic",
      iterations,
      toolCallCount,
      action: parsedFinal?.action ?? "ask_clarifying",
      confirmationsQueued: confirmationsQueued.length,
      schedulingDetected: parsedFinal?.schedulingDetected ?? false,
    },
  });

  return {
    action: parsedFinal?.action ?? "ask_clarifying",
    reasoning:
      parsedFinal?.reasoning ??
      "Agentic L2 finished without a structured final pass; deferring to user review.",
    actionItems: parsedFinal?.actionItems ?? [],
    retrievalProvenance: null,
    usageId: rec.usageId,
    confirmationQuestions: confirmationsQueued,
    inferredFacts: parsedFinal?.inferredFacts ?? [],
    availabilityChecks,
    schedulingDetected: parsedFinal?.schedulingDetected ?? false,
    iterations,
    toolCallCount,
  };
}

async function emitFinalPass(args: {
  model: string;
  conversation: OpenAI.Chat.ChatCompletionMessageParam[];
  onUsage: (u: { input: number; output: number; cached: number }) => void;
}): Promise<ReturnType<typeof parseFinalJson>> {
  const conv: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...args.conversation,
    {
      role: "user",
      content:
        "Emit ONLY the final JSON object now, conforming to the agentic_l2_final schema. Do not call any more tools.",
    },
  ];
  try {
    const resp = await openai().chat.completions.create({
      model: args.model,
      messages: conv,
      tool_choice: "none",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agentic_l2_final",
          strict: true,
          schema: AGENTIC_L2_FINAL_SCHEMA,
        },
      },
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    args.onUsage({
      input: resp.usage?.prompt_tokens ?? 0,
      output: resp.usage?.completion_tokens ?? 0,
      cached:
        (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
          ?.prompt_tokens_details?.cached_tokens ?? 0,
    });
    return parseFinalJson(raw);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "agentic_l2", step: "forced_final_pass" },
    });
    return null;
  }
}

function looksLikeJsonObject(s: string): boolean {
  const t = s.trim();
  return t.startsWith("{") && t.endsWith("}");
}

const VALID_ACTIONS: DeepAction[] = [
  "draft_reply",
  "archive",
  "snooze",
  "no_op",
  "ask_clarifying",
  "notify_only",
];

export function parseFinalJson(raw: string): {
  action: DeepAction;
  reasoning: string;
  actionItems: ExtractedActionItem[];
  inferredFacts: InferredFact[];
  schedulingDetected: boolean;
} | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const action: DeepAction = VALID_ACTIONS.includes(o.action as DeepAction)
    ? (o.action as DeepAction)
    : "ask_clarifying";
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning
      : "Agentic L2 produced no reasoning; deferring to user review.";
  const actionItems = parseActionItemsLocal(o.actionItems);
  const inferredFacts = parseInferredFactsLocal(o.inferredFacts);
  const schedulingDetected = o.schedulingDetected === true;
  return { action, reasoning, actionItems, inferredFacts, schedulingDetected };
}

function parseActionItemsLocal(raw: unknown): ExtractedActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedActionItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title =
      typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
    if (!title) continue;
    let dueDate: string | null = null;
    if (typeof r.dueDate === "string") {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(r.dueDate.trim());
      if (m) dueDate = m[1];
    }
    const confidence = Math.max(
      0,
      Math.min(1, typeof r.confidence === "number" ? r.confidence : 0)
    );
    out.push({ title, dueDate, confidence });
  }
  return out;
}

function parseInferredFactsLocal(raw: unknown): InferredFact[] {
  if (!Array.isArray(raw)) return [];
  const out: InferredFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const topic =
      typeof r.topic === "string" ? r.topic.trim().slice(0, 64) : "";
    const value =
      typeof r.value === "string" ? r.value.trim().slice(0, 200) : "";
    if (!topic || !value) continue;
    const confidence = Math.max(
      0,
      Math.min(1, typeof r.confidence === "number" ? r.confidence : 0)
    );
    const source =
      typeof r.source === "string" ? r.source.trim().slice(0, 64) : "unknown";
    out.push({ topic, value, confidence, source });
  }
  return out;
}
