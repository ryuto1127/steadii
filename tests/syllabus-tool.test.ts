import { describe, expect, it, vi } from "vitest";

const hoist = vi.hoisted(() => {
  type Block =
    | { id: string; type: "toggle"; toggle: { rich_text: Array<{ plain_text: string }> } }
    | {
        id: string;
        type: "paragraph";
        paragraph: { rich_text: Array<{ plain_text: string }> };
      }
    | { id: string; type: "heading_2"; heading_2: unknown };

  const blocks: Record<string, Block[]> = {
    "page-1": [
      {
        id: "heading-a",
        type: "heading_2",
        heading_2: {},
      },
      {
        id: "toggle-a",
        type: "toggle",
        toggle: {
          rich_text: [{ plain_text: "Full source content" }],
        },
      },
    ],
    "toggle-a": [
      {
        id: "p1",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Paragraph one." }] },
      },
      {
        id: "p2",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Paragraph two." }] },
      },
    ],
    "page-empty": [
      {
        id: "h",
        type: "heading_2",
        heading_2: {},
      },
    ],
  };

  const client = {
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }: { block_id: string }) => ({
          results: blocks[block_id] ?? [],
          next_cursor: null,
        })),
      },
    },
  };

  return { client };
});

vi.mock("@/lib/integrations/notion/client", () => ({
  getNotionClientForUser: async () => ({ client: hoist.client, connection: { id: "c" } }),
}));

import { readSyllabusFullText } from "@/lib/agent/tools/syllabus";

describe("read_syllabus_full_text tool", () => {
  it("concatenates paragraphs inside the Full source content toggle", async () => {
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusPageId: "page-1" }
    );
    expect(out.found).toBe(true);
    expect(out.fullText).toBe("Paragraph one.\n\nParagraph two.");
    expect(out.truncated).toBe(false);
  });

  it("returns found=false when no toggle is present", async () => {
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusPageId: "page-empty" }
    );
    expect(out.found).toBe(false);
    expect(out.fullText).toBe("");
  });

  it("is classified as a read-mutability tool (no confirmation required)", () => {
    expect(readSyllabusFullText.schema.mutability).toBe("read");
  });
});
