import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { MAIN_SYSTEM_PROMPT } from "./prompts/main";
import { selectModel } from "./models";
import { recordUsage } from "./usage";
import { buildUserContext, serializeContextForPrompt } from "./context";
import { getUserConfirmationMode } from "./preferences";
import { requiresConfirmation } from "./confirmation";
import { getToolByName, openAIToolDefs } from "./tool-registry";
import { discoverResources } from "@/lib/integrations/notion/discovery";
import {
  assertCreditsAvailable,
  BillingQuotaExceededError,
} from "@/lib/billing/credits";
import { db } from "@/lib/db/client";
import {
  messages as messagesTable,
  chats,
  messageAttachments,
  pendingToolCalls,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type OpenAI from "openai";

export type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "message_start"; assistantMessageId: string }
  | { type: "message_end"; assistantMessageId: string; text: string }
  | {
      type: "tool_call_started";
      toolName: string;
      args: unknown;
      toolCallId: string;
    }
  | {
      type: "tool_call_result";
      toolName: string;
      toolCallId: string;
      result: unknown;
      ok: boolean;
    }
  | {
      type: "tool_call_pending";
      toolName: string;
      toolCallId: string;
      pendingId: string;
      args: unknown;
    }
  | { type: "error"; code: string; message: string };

export type OrchestratorRequest = {
  userId: string;
  chatId: string;
};

const MAX_TOOL_ITERATIONS = 5;

export async function* streamChatResponse(
  req: OrchestratorRequest
): AsyncGenerator<StreamEvent> {
  const history = await loadHistory(req.chatId);
  if (history.length === 0) {
    yield { type: "error", code: "NO_MESSAGES", message: "No messages in chat." };
    return;
  }

  try {
    await assertCreditsAvailable(req.userId);
  } catch (err) {
    if (err instanceof BillingQuotaExceededError) {
      const { used, limit, plan } = err.balance;
      yield {
        type: "error",
        code: "BILLING_QUOTA_EXCEEDED",
        message: `You've used ${used} of ${limit} credits this month on the ${plan} plan. ${
          plan === "free"
            ? "Upgrade to Pro or wait until the cycle resets."
            : "Wait until the cycle resets."
        }`,
      };
      return;
    }
    throw err;
  }

  try {
    await discoverResources(req.userId);
  } catch (err) {
    console.error("pre-chat discovery failed (non-fatal)", err);
  }
  const ctx = await buildUserContext(req.userId);
  const contextPrompt = serializeContextForPrompt(ctx);
  const confirmationMode = await getUserConfirmationMode(req.userId);
  const model = selectModel("chat");

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: MAIN_SYSTEM_PROMPT },
    { role: "system", content: contextPrompt },
    ...repairDanglingToolCalls(history).map(toOpenAIMessage),
  ];

  const assistantId = await insertPendingAssistant(req.chatId, model);
  yield { type: "message_start", assistantMessageId: assistantId };

  let iterations = 0;
  let finalText = "";

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;

    let text = "";
    let toolCalls: Array<{ id: string; name: string; args: string }> = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    try {
      const stream = await openai().chat.completions.create({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: conversation,
        tools: openAIToolDefs(),
        tool_choice: "auto",
      });

      const partialToolCalls: Record<
        number,
        { id: string; name: string; args: string }
      > = {};

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          text += delta.content;
          yield { type: "text_delta", delta: delta.content };
        }
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
              if (tc.function?.name) partialToolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments)
                partialToolCalls[idx].args += tc.function.arguments;
            }
          }
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
          const cacheInfo = (chunk.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          }).prompt_tokens_details;
          cachedTokens = cacheInfo?.cached_tokens ?? 0;
        }
      }

      toolCalls = Object.values(partialToolCalls).filter((c) => c.id && c.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown OpenAI error";
      await db
        .update(messagesTable)
        .set({ content: `(error: ${message})` })
        .where(eq(messagesTable.id, assistantId));
      yield { type: "error", code: "OPENAI_FAILED", message };
      return;
    }

    await recordUsage({
      userId: req.userId,
      chatId: req.chatId,
      messageId: assistantId,
      model,
      taskType: toolCalls.length > 0 ? "tool_call" : "chat",
      inputTokens,
      outputTokens,
      cachedTokens,
    });

    finalText = text;

    if (toolCalls.length === 0) {
      // plain response — done
      await db
        .update(messagesTable)
        .set({ content: text })
        .where(eq(messagesTable.id, assistantId));
      break;
    }

    // Persist the tool-call envelope on the assistant row so a resumed
    // stream can rebuild the OpenAI conversation exactly.
    await db
      .update(messagesTable)
      .set({
        content: text,
        toolCalls: toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      })
      .where(eq(messagesTable.id, assistantId));

    // Append the assistant's tool-call message to the conversation
    conversation.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    });

    // Execute each tool, possibly pausing for confirmation
    let pausedForConfirmation = false;
    for (const call of toolCalls) {
      const tool = getToolByName(call.name);
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

      if (requiresConfirmation(confirmationMode, tool.schema.mutability)) {
        const [pending] = await db
          .insert(pendingToolCalls)
          .values({
            userId: req.userId,
            chatId: req.chatId,
            assistantMessageId: assistantId,
            toolName: call.name,
            toolCallId: call.id,
            args: parsedArgs as Record<string, unknown>,
          })
          .returning({ id: pendingToolCalls.id });

        yield {
          type: "tool_call_pending",
          toolName: call.name,
          toolCallId: call.id,
          pendingId: pending.id,
          args: parsedArgs,
        };
        pausedForConfirmation = true;
        break;
      }

      yield {
        type: "tool_call_started",
        toolName: call.name,
        toolCallId: call.id,
        args: parsedArgs,
      };
      let resultPayload: unknown;
      let ok = true;
      try {
        resultPayload = await tool.execute({ userId: req.userId }, parsedArgs);
      } catch (err) {
        ok = false;
        resultPayload = toolErrorPayload(err);
      }
      const serialized = JSON.stringify(resultPayload);
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: serialized,
      });
      // Persist so a later `loadHistory` can pair this tool response with the
      // assistant's `tool_calls` row. Without this, OpenAI rejects the next
      // turn with "tool_call_ids did not have response messages".
      await db.insert(messagesTable).values({
        chatId: req.chatId,
        role: "tool",
        content: serialized,
        toolCallId: call.id,
      });
      yield {
        type: "tool_call_result",
        toolName: call.name,
        toolCallId: call.id,
        result: resultPayload,
        ok,
      };
    }

    if (pausedForConfirmation) {
      await db
        .update(messagesTable)
        .set({ content: text })
        .where(eq(messagesTable.id, assistantId));
      yield { type: "message_end", assistantMessageId: assistantId, text };
      return;
    }
  }

  await db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, req.chatId));

  yield { type: "message_end", assistantMessageId: assistantId, text: finalText };
}

import { toOpenAIMessage, type StoredMessage } from "./messages";

const NOT_CONNECTED_MESSAGES: Record<string, string> = {
  CLASSROOM_NOT_CONNECTED:
    "Google Classroom access hasn't been granted. Ask the user to reconnect their Google account (sign out and sign back in) to enable class-related features.",
  TASKS_NOT_CONNECTED:
    "Google Tasks access hasn't been granted. Ask the user to reconnect their Google account to enable task features.",
  CALENDAR_NOT_CONNECTED:
    "Google Calendar access hasn't been granted. Ask the user to reconnect their Google account to enable calendar features.",
  NOTION_NOT_CONNECTED:
    "Notion isn't connected. Ask the user to connect Notion from Settings.",
};

function toolErrorPayload(err: unknown): { error: string; message: string } {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : null;
  if (code && NOT_CONNECTED_MESSAGES[code]) {
    return { error: code, message: NOT_CONNECTED_MESSAGES[code] };
  }
  return {
    error: code ?? "tool_failed",
    message: err instanceof Error ? err.message : "tool_failed",
  };
}

// Walk the history and ensure every assistant tool_call is followed by a
// matching `tool` row. If a tool response is missing (e.g. the stream died
// before we could persist one under an older codepath), splice in a synthetic
// error so OpenAI doesn't 400 on the next turn. Idempotent.
function repairDanglingToolCalls(history: StoredMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    out.push(msg);
    if (msg.role !== "assistant" || !msg.toolCalls || msg.toolCalls.length === 0) {
      continue;
    }
    const responded = new Set<string>();
    let j = i + 1;
    while (j < history.length && history[j].role === "tool") {
      const id = history[j].toolCallId;
      if (id) responded.add(id);
      j++;
    }
    for (const call of msg.toolCalls) {
      if (responded.has(call.id)) continue;
      out.push({
        id: `synthetic-${call.id}`,
        role: "tool",
        content: JSON.stringify({ error: "tool_result_missing" }),
        toolCallId: call.id,
        toolCalls: null,
        attachments: [],
      });
    }
  }
  return out;
}

async function loadHistory(chatId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(asc(messagesTable.createdAt));
  const live = rows.filter((r) => !r.deletedAt);
  if (live.length === 0) return [];

  const ids = live.map((r) => r.id);
  const atts = await db
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, ids));
  const byMessage = new Map<string, typeof atts>();
  for (const a of atts) {
    const list = byMessage.get(a.messageId) ?? [];
    list.push(a);
    byMessage.set(a.messageId, list);
  }

  return live.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    toolCallId: r.toolCallId,
    toolCalls: (r.toolCalls as StoredMessage["toolCalls"]) ?? null,
    attachments: (byMessage.get(r.id) ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.url,
      filename: a.filename,
    })),
  }));
}

async function insertPendingAssistant(chatId: string, model: string): Promise<string> {
  const [row] = await db
    .insert(messagesTable)
    .values({ chatId, role: "assistant", content: "", model })
    .returning({ id: messagesTable.id });
  return row.id;
}

export async function generateChatTitle(
  userId: string,
  chatId: string,
  firstUserMessage: string,
  firstAssistantMessage: string
): Promise<string> {
  const model = selectModel("chat_title");
  const resp = await openai().chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Summarize this conversation in at most 6 words. Match the language of the user. No quotes, no trailing punctuation.",
      },
      { role: "user", content: `User: ${firstUserMessage}\n\nAssistant: ${firstAssistantMessage}` },
    ],
  });

  const title = resp.choices[0]?.message?.content?.trim() ?? "New chat";

  await recordUsage({
    userId,
    chatId,
    model,
    taskType: "chat_title",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens: 0,
  });

  await db.update(chats).set({ title }).where(eq(chats.id, chatId));
  return title;
}

export async function attachmentsForMessage(messageId: string) {
  return db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId));
}
