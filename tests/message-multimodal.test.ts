import { describe, expect, it } from "vitest";
import { toOpenAIMessage, type StoredMessage } from "@/lib/agent/messages";

function makeMessage(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    id: "m1",
    role: "user",
    content: "",
    toolCallId: null,
    toolCalls: null,
    attachments: [],
    ...overrides,
  };
}

describe("toOpenAIMessage multimodal construction", () => {
  it("text-only user message stays as a string", () => {
    const out = toOpenAIMessage(makeMessage({ content: "hello" }));
    expect(out).toEqual({ role: "user", content: "hello" });
  });

  it("user message with an image attachment becomes multimodal parts", () => {
    const out = toOpenAIMessage(
      makeMessage({
        content: "teach me how to solve this problem",
        attachments: [
          {
            id: "a1",
            kind: "image",
            url: "https://blob.example/img.png",
            filename: "khan.png",
          },
        ],
      })
    );
    expect(out).toEqual({
      role: "user",
      content: [
        { type: "text", text: "teach me how to solve this problem" },
        {
          type: "image_url",
          image_url: { url: "https://blob.example/img.png" },
        },
      ],
    });
  });

  it("image-only user message still produces an image_url part", () => {
    const out = toOpenAIMessage(
      makeMessage({
        content: "",
        attachments: [
          {
            id: "a1",
            kind: "image",
            url: "https://blob.example/img.png",
            filename: null,
          },
        ],
      })
    );
    expect(out.role).toBe("user");
    expect(Array.isArray(out.content)).toBe(true);
    const parts = out.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === "image_url")).toBe(true);
  });

  it("PDF attachment becomes a text note (not sent inline)", () => {
    const out = toOpenAIMessage(
      makeMessage({
        content: "check this syllabus",
        attachments: [
          {
            id: "a1",
            kind: "pdf",
            url: "https://blob.example/syllabus.pdf",
            filename: "cs350.pdf",
          },
        ],
      })
    );
    const parts = out.content as Array<{ type: string; text?: string }>;
    expect(parts[0]).toEqual({ type: "text", text: "check this syllabus" });
    expect(parts[1].type).toBe("text");
    expect(parts[1].text).toContain("cs350.pdf");
    expect(parts[1].text).toContain("https://blob.example/syllabus.pdf");
    // PDFs must not become image_url parts.
    expect(parts.some((p) => p.type === "image_url")).toBe(false);
  });

  it("mixed image + pdf on one user message produces both part types", () => {
    const out = toOpenAIMessage(
      makeMessage({
        content: "help",
        attachments: [
          { id: "a1", kind: "image", url: "https://x/i.png", filename: "i.png" },
          { id: "a2", kind: "pdf", url: "https://x/d.pdf", filename: "d.pdf" },
        ],
      })
    );
    const parts = out.content as Array<{ type: string }>;
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(parts.filter((p) => p.type === "text")).toHaveLength(2); // user content + pdf note
  });

  it("assistant tool-call row keeps its tool_calls envelope, never becomes multimodal", () => {
    const out = toOpenAIMessage(
      makeMessage({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "notion_create_row", arguments: "{}" },
          },
        ],
        // Attachments on an assistant row shouldn't leak into content.
        attachments: [
          { id: "a1", kind: "image", url: "https://x/i.png", filename: null },
        ],
      })
    );
    expect(out.role).toBe("assistant");
    expect("tool_calls" in out).toBe(true);
    // Content is plain (null), not a multimodal array.
    expect(typeof out.content === "string" || out.content === null).toBe(true);
  });

  it("tool role keeps tool_call_id and string content", () => {
    const out = toOpenAIMessage(
      makeMessage({
        role: "tool",
        toolCallId: "call_1",
        content: '{"ok":true}',
      })
    );
    expect(out).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"ok":true}',
    });
  });
});
