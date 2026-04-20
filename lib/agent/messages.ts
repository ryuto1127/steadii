import type OpenAI from "openai";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId: string | null;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> | null;
  attachments: Array<{
    id: string;
    kind: "image" | "pdf";
    url: string;
    filename: string | null;
  }>;
};

// Build the OpenAI chat-completions message shape from one of our stored
// rows. Pure function — no I/O — so it's safe to unit-test in isolation.
//
// Image attachments become multimodal `image_url` parts; the blob store
// serves public URLs so OpenAI fetches them directly. PDFs can't ride
// along inline on chat completions, so we surface them as a text note
// the model can reason about (it can still call the syllabus tools to
// actually read the content if the user asks).
export function toOpenAIMessage(
  m: StoredMessage
): OpenAI.Chat.ChatCompletionMessageParam {
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId ?? "",
      content: m.content,
    };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls,
    };
  }

  if (m.role === "user" && m.attachments.length > 0) {
    const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const a of m.attachments) {
      if (a.kind === "image") {
        parts.push({ type: "image_url", image_url: { url: a.url } });
      } else {
        parts.push({
          type: "text",
          text: `[User attached PDF: ${a.filename ?? "file.pdf"} — ${a.url}]`,
        });
      }
    }
    if (parts.length === 0) {
      parts.push({ type: "text", text: "(attachment)" });
    }
    return { role: "user", content: parts };
  }

  return { role: m.role, content: m.content };
}
