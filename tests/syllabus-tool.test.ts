import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
    OPENAI_API_KEY: "sk-test",
  }),
}));

const state: { result: Array<{ fullText: string | null }> } = { result: [] };

vi.mock("@/lib/db/client", () => {
  const chain: {
    select: () => typeof chain;
    from: () => typeof chain;
    where: () => typeof chain;
    limit: () => Promise<typeof state.result>;
  } = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(state.result),
  };
  return { db: chain };
});

import { readSyllabusFullText } from "@/lib/agent/tools/syllabus";

describe("read_syllabus_full_text tool", () => {
  const sid = "c0a801b0-0000-4000-8000-000000000000";

  beforeEach(() => {
    state.result = [];
  });

  it("returns the fullText when the row exists and is owned by the user", async () => {
    state.result = [{ fullText: "Paragraph one.\n\nParagraph two." }];
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusId: sid }
    );
    expect(out.found).toBe(true);
    expect(out.fullText).toBe("Paragraph one.\n\nParagraph two.");
    expect(out.truncated).toBe(false);
    expect(out.syllabusId).toBe(sid);
  });

  it("returns found=false when the SQL filter (userId / deletedAt) yields no row", async () => {
    state.result = [];
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusId: sid }
    );
    expect(out.found).toBe(false);
    expect(out.fullText).toBe("");
    expect(out.truncated).toBe(false);
  });

  it("returns found=false when fullText is null", async () => {
    state.result = [{ fullText: null }];
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusId: sid }
    );
    expect(out.found).toBe(false);
  });

  it("truncates fullText longer than 60_000 chars", async () => {
    state.result = [{ fullText: "x".repeat(70_000) }];
    const out = await readSyllabusFullText.execute(
      { userId: "u" },
      { syllabusId: sid }
    );
    expect(out.truncated).toBe(true);
    expect(out.fullText.length).toBe(60_000);
  });

  it("is classified as a read-mutability tool (no confirmation required)", () => {
    expect(readSyllabusFullText.schema.mutability).toBe("read");
  });

  it("declares syllabusId as the only required parameter (Postgres uuid, not Notion page id)", () => {
    expect(readSyllabusFullText.schema.parameters.required).toEqual([
      "syllabusId",
    ]);
  });
});
