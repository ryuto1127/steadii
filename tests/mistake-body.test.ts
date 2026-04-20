import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  notionConnections: {},
  registeredResources: {},
  auditLog: {},
  messages: {},
  messageAttachments: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
}));
vi.mock("@/lib/utils/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/integrations/notion/client", () => ({
  notionClientFromToken: () => ({ pages: { create: async () => ({}) } }),
}));

import { buildMistakeBody, mistakeSaveSchema } from "@/lib/mistakes/save";

describe("buildMistakeBody", () => {
  it("renders images, problem heading, and explanation paragraphs", () => {
    const blocks = buildMistakeBody({
      userQuestion: "Solve 2+2.",
      assistantExplanation: "Step 1.\n\nStep 2.",
      imageUrls: ["https://img.test/a.png"],
    }) as Array<Record<string, unknown>>;

    const types = blocks.map((b) => b.type);
    expect(types[0]).toBe("image");
    expect(types.filter((t) => t === "heading_2")).toHaveLength(2);
    // Two paragraphs in the explanation + one for the problem body
    expect(types.filter((t) => t === "paragraph").length).toBeGreaterThanOrEqual(3);
  });

  it("chunks very long explanation text for Notion's 2000-char rich_text cap", () => {
    const longText = "a".repeat(4500);
    const blocks = buildMistakeBody({
      userQuestion: "",
      assistantExplanation: longText,
      imageUrls: [],
    }) as Array<{
      type: string;
      paragraph?: { rich_text: Array<{ text: { content: string } }> };
    }>;
    const pText = blocks.find((b) => b.type === "paragraph")!;
    const chunks = pText.paragraph!.rich_text;
    for (const c of chunks) {
      expect(c.text.content.length).toBeLessThanOrEqual(1900);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("mistakeSaveSchema", () => {
  it("requires chatId, assistantMessageId, title", () => {
    expect(() =>
      mistakeSaveSchema.parse({
        chatId: "not-a-uuid",
        assistantMessageId: "00000000-0000-0000-0000-000000000000",
        title: "x",
      })
    ).toThrow();
  });

  it("accepts a valid payload with optional fields", () => {
    const parsed = mistakeSaveSchema.parse({
      chatId: "00000000-0000-0000-0000-000000000001",
      assistantMessageId: "00000000-0000-0000-0000-000000000002",
      title: "Prob",
      difficulty: "hard",
      tags: ["vectors"],
    });
    expect(parsed.difficulty).toBe("hard");
  });
});
