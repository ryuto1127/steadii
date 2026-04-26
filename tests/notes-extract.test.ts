import { describe, expect, it, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("@/lib/env", () => ({ env: () => ({ OPENAI_API_KEY: "x" }) }));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({ chat: { completions: { create: createMock } } }),
}));
vi.mock("@/lib/agent/usage", () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/credits", () => ({
  assertCreditsAvailable: vi.fn(async () => ({})),
  BillingQuotaExceededError: class extends Error {},
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  buildNotesUserContent,
  countPagesInMarkdown,
  extractHandwrittenNote,
  NOTES_OCR_SYSTEM_PROMPT,
} from "@/lib/notes/extract";
import { recordUsage } from "@/lib/agent/usage";
import { assertCreditsAvailable } from "@/lib/billing/credits";

describe("buildNotesUserContent", () => {
  it("emits a text instruction + image_url block for a public image url", () => {
    const content = buildNotesUserContent({
      kind: "image",
      url: "https://blob.example/note.png",
      mimeType: "image/png",
    });
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Transcribe"),
    });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://blob.example/note.png" },
    });
  });

  it("supports a base64 data URL for client-side previews", () => {
    const content = buildNotesUserContent({
      kind: "image_data_url",
      dataUrl: "data:image/png;base64,AAAA",
      mimeType: "image/png",
    });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });
});

describe("countPagesInMarkdown", () => {
  it("returns 0 for empty markdown", () => {
    expect(countPagesInMarkdown("")).toBe(0);
  });

  it("returns 1 when no Page heading is present", () => {
    expect(countPagesInMarkdown("Just one transcription, no headings.")).toBe(1);
  });

  it("counts ## Page N headings for multi-page transcriptions", () => {
    const md =
      "## Page 1\n\nfirst page text\n\n## Page 2\n\nsecond page text\n\n## Page 3\n\nthird";
    expect(countPagesInMarkdown(md)).toBe(3);
  });

  it("matches headings case-insensitively", () => {
    expect(countPagesInMarkdown("## page 1\n\nfoo\n\n## PAGE 2\n\nbar")).toBe(2);
  });
});

describe("NOTES_OCR_SYSTEM_PROMPT", () => {
  it("locks in the verbatim invariant", () => {
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/VERBATIM/);
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/Do not summarize/);
  });
  it("documents math + diagram + multi-page conventions", () => {
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/LaTeX/);
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/\$\$/);
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/Diagrams/);
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/Page N/);
    expect(NOTES_OCR_SYSTEM_PROMPT).toMatch(/illegible/);
  });
});

describe("extractHandwrittenNote", () => {
  beforeEach(() => {
    createMock.mockReset();
    (recordUsage as unknown as ReturnType<typeof vi.fn>).mockClear();
    (assertCreditsAvailable as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("calls vision with the OCR system prompt and returns the markdown verbatim", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "  # Lecture notes\n\n$x = 1$  " } }],
      usage: { prompt_tokens: 1200, completion_tokens: 300 },
    });

    const result = await extractHandwrittenNote({
      userId: "user-1",
      source: {
        kind: "image",
        url: "https://blob.example/page1.png",
        mimeType: "image/png",
      },
    });

    expect(assertCreditsAvailable).toHaveBeenCalledWith("user-1");
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe("gpt-5.4");
    expect(call.messages[0]).toEqual({
      role: "system",
      content: NOTES_OCR_SYSTEM_PROMPT,
    });
    // No structured-output / json_schema — we want raw markdown.
    expect(call.response_format).toBeUndefined();

    expect(result.markdown).toBe("# Lecture notes\n\n$x = 1$");
    expect(result.pagesProcessed).toBe(1);

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        taskType: "notes_extract",
        inputTokens: 1200,
        outputTokens: 300,
      })
    );
  });

  it("counts multiple ## Page N sections in the model output", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "## Page 1\n\nfoo\n\n## Page 2\n\nbar\n\n## Page 3\n\nbaz",
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const result = await extractHandwrittenNote({
      userId: "user-1",
      source: {
        kind: "image",
        url: "https://blob.example/multi.pdf",
        mimeType: "image/png",
      },
    });
    expect(result.pagesProcessed).toBe(3);
  });

  it("propagates BillingQuotaExceededError from credit gate without calling OpenAI", async () => {
    class FakeQuotaErr extends Error {
      code = "BILLING_QUOTA_EXCEEDED";
    }
    (assertCreditsAvailable as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new FakeQuotaErr("over quota")
    );

    await expect(
      extractHandwrittenNote({
        userId: "user-2",
        source: {
          kind: "image",
          url: "https://blob.example/x.png",
          mimeType: "image/png",
        },
      })
    ).rejects.toThrow("over quota");
    expect(createMock).not.toHaveBeenCalled();
  });
});
