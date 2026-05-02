import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration coverage for the upload → extract → save chain. We can't
// hit the real DB / OpenAI / Vercel Blob from a unit-test environment,
// so we mock those layers and assert the wiring: the markdown produced
// by `extractHandwrittenNote` lands in `mistake_notes` with
// source="handwritten_ocr" and the right blob_asset_id, the chunk-and-
// embed fanout fires, and the audit row records the action.

const mistakeInserts: Array<Record<string, unknown>> = [];
const auditInserts: Array<Record<string, unknown>> = [];
let nextMistakeId = "mistake-1";

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: (table: { _table?: string } | undefined) => ({
      values: (row: Record<string, unknown>) => {
        // Record the row eagerly so callers that `await db.insert(...).values(...)`
        // (no `.returning()`) — like the audit_log inserts — still register.
        const target = table?._table;
        if (target === "mistake_notes") {
          mistakeInserts.push(row);
        } else if (target === "audit_log") {
          auditInserts.push(row);
        }
        const result =
          target === "mistake_notes"
            ? [{ id: nextMistakeId }]
            : target === "audit_log"
              ? []
              : [{ id: "unknown" }];
        return {
          returning: async () => result,
          then: (resolve: (value: typeof result) => unknown) =>
            resolve(result),
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => {} }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  mistakeNotes: { _table: "mistake_notes", id: {} },
  mistakeNoteImages: { _table: "mistake_note_images" },
  mistakeNoteChunks: { _table: "mistake_note_chunks", mistakeId: {} },
  syllabusChunks: { _table: "syllabus_chunks" },
  auditLog: { _table: "audit_log" },
  messages: {},
  messageAttachments: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
}));

const assertMock = vi.fn(async (_userId: string) => ({}));
const refreshMock = vi.fn(async (_args: unknown) => ({ count: 3 }));

vi.mock("@/lib/billing/credits", () => {
  class FakeBillingErr extends Error {
    code = "BILLING_QUOTA_EXCEEDED" as const;
    balance = {};
  }
  return {
    assertCreditsAvailable: (userId: string) => assertMock(userId),
    BillingQuotaExceededError: FakeBillingErr,
  };
});

vi.mock("@/lib/embeddings/entity-embed", () => ({
  refreshMistakeEmbeddings: (args: unknown) => refreshMock(args),
}));

import { saveHandwrittenMistakeNote } from "@/lib/mistakes/save";
import { BillingQuotaExceededError } from "@/lib/billing/credits";

beforeEach(() => {
  mistakeInserts.length = 0;
  auditInserts.length = 0;
  nextMistakeId = "mistake-1";
  assertMock.mockClear();
  refreshMock.mockClear();
});

describe("saveHandwrittenMistakeNote", () => {
  it("persists the OCR markdown with source='handwritten_ocr' and the source blob", async () => {
    const result = await saveHandwrittenMistakeNote({
      userId: "user-1",
      input: {
        title: "Calculus ch5 — page 2",
        classId: "11111111-1111-1111-1111-111111111111",
        unit: "Integration",
        difficulty: "medium",
        tags: ["integration", "by-parts"],
        bodyMarkdown: "# Notes\n\n$\\int u\\,dv = uv - \\int v\\,du$",
        sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
      },
    });

    expect(result).toEqual({ id: "mistake-1" });
    expect(assertMock).toHaveBeenCalledWith("user-1");
    expect(mistakeInserts).toHaveLength(1);
    expect(mistakeInserts[0]).toMatchObject({
      userId: "user-1",
      classId: "11111111-1111-1111-1111-111111111111",
      title: "Calculus ch5 — page 2",
      unit: "Integration",
      difficulty: "medium",
      tags: ["integration", "by-parts"],
      bodyFormat: "markdown",
      bodyMarkdown: "# Notes\n\n$\\int u\\,dv = uv - \\int v\\,du$",
      source: "handwritten_ocr",
      sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("triggers chunk + embed fanout with the note body so retrieval picks it up immediately", async () => {
    await saveHandwrittenMistakeNote({
      userId: "user-1",
      input: {
        title: "Lecture transcription",
        bodyMarkdown: "## Page 1\n\nfoo\n\n## Page 2\n\nbar",
        sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
      },
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        mistakeId: "mistake-1",
        text: "## Page 1\n\nfoo\n\n## Page 2\n\nbar",
      })
    );
  });

  it("writes an audit row with action='mistake.save_handwritten'", async () => {
    await saveHandwrittenMistakeNote({
      userId: "user-1",
      input: {
        title: "Audit me",
        bodyMarkdown: "body",
        sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
      },
    });

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      userId: "user-1",
      action: "mistake.save_handwritten",
      resourceType: "mistake_note",
      resourceId: "mistake-1",
      result: "success",
      detail: expect.objectContaining({
        title: "Audit me",
        sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
      }),
    });
  });

  it("propagates BillingQuotaExceededError without inserting the row", async () => {
    assertMock.mockRejectedValueOnce(new BillingQuotaExceededError({} as never));
    await expect(
      saveHandwrittenMistakeNote({
        userId: "user-1",
        input: {
          title: "x",
          bodyMarkdown: "y",
          sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
        },
      })
    ).rejects.toBeInstanceOf(BillingQuotaExceededError);
    expect(mistakeInserts).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("survives an embedding-fanout failure (note row stays the source of truth)", async () => {
    refreshMock.mockRejectedValueOnce(new Error("embedding service down"));
    const result = await saveHandwrittenMistakeNote({
      userId: "user-1",
      input: {
        title: "Resilient save",
        bodyMarkdown: "still saved even if chunks fail",
        sourceBlobAssetId: "22222222-2222-2222-2222-222222222222",
      },
    });
    expect(result).toEqual({ id: "mistake-1" });
    expect(mistakeInserts).toHaveLength(1);
    expect(auditInserts).toHaveLength(1);
  });
});
