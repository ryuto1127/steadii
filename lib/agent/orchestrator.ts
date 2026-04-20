import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { MAIN_SYSTEM_PROMPT } from "./prompts/main";
import { selectModel } from "./models";
import { recordUsage } from "./usage";
import { buildUserContext, serializeContextForPrompt } from "./context";
import { db } from "@/lib/db/client";
import { messages as messagesTable, chats, messageAttachments } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "message_start"; assistantMessageId: string }
  | { type: "message_end"; assistantMessageId: string; text: string }
  | { type: "tool_call_stub"; name: string }
  | { type: "error"; code: string; message: string };

export type OrchestratorRequest = {
  userId: string;
  chatId: string;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

export async function* streamChatResponse(
  req: OrchestratorRequest
): AsyncGenerator<StreamEvent> {
  const history = await loadHistory(req.chatId);
  if (history.length === 0) {
    yield { type: "error", code: "NO_MESSAGES", message: "No messages in chat." };
    return;
  }

  const ctx = await buildUserContext(req.userId);
  const contextPrompt = serializeContextForPrompt(ctx);
  const model = selectModel("chat");

  const openaiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: MAIN_SYSTEM_PROMPT },
    { role: "system", content: contextPrompt },
    ...history
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
  ];

  const assistantId = await insertPendingAssistant(req.chatId, model);
  yield { type: "message_start", assistantMessageId: assistantId };

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  try {
    const stream = await openai().chat.completions.create({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: openaiMessages,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        fullText += delta;
        yield { type: "text_delta", delta };
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
        const cacheInfo = (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } })
          .prompt_tokens_details;
        cachedTokens = cacheInfo?.cached_tokens ?? 0;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown OpenAI error";
    await db
      .update(messagesTable)
      .set({ content: `(error: ${message})` })
      .where(eq(messagesTable.id, assistantId));
    yield { type: "error", code: "OPENAI_FAILED", message };
    return;
  }

  await db
    .update(messagesTable)
    .set({ content: fullText })
    .where(eq(messagesTable.id, assistantId));

  await db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, req.chatId));

  await recordUsage({
    userId: req.userId,
    chatId: req.chatId,
    messageId: assistantId,
    model,
    taskType: "chat",
    inputTokens,
    outputTokens,
    cachedTokens,
  });

  yield { type: "message_end", assistantMessageId: assistantId, text: fullText };
}

async function loadHistory(chatId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(asc(messagesTable.createdAt));
  return rows
    .filter((r) => !r.deletedAt)
    .map((r) => ({ id: r.id, role: r.role, content: r.content }));
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
