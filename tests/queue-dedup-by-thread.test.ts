import { describe, expect, it, vi } from "vitest";

// Tests for the queue's per-thread dedup. Surfaced when Ryuto's home
// (2026-05-05) showed 5 identical GhostFilter recruiter cards from the
// same email thread. Each follow-up email creates its own inbox_item +
// agent_draft, so the queue listed all 5 — `dedupePendingDraftsByThread`
// keeps only the newest per `threadExternalId` while preserving items
// with null threadExternalId (rare, malformed Gmail headers).

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    NOTION_CLIENT_ID: "test",
    NOTION_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  dedupePendingDraftsByThread,
  type PendingDraftRow,
} from "@/lib/agent/queue/build";

function makeRow(args: {
  id: string;
  inboxId: string;
  thread: string | null;
  createdAt: Date;
  subject: string;
}): PendingDraftRow {
  return {
    draft: {
      id: args.id,
      userId: "u1",
      inboxItemId: args.inboxId,
      action: "draft_reply",
      status: "pending",
      createdAt: args.createdAt,
    } as PendingDraftRow["draft"],
    inboxId: args.inboxId,
    threadExternalId: args.thread,
    senderName: "GhostFilter",
    senderEmail: "hello@ghostfilter.io",
    subject: args.subject,
  };
}

describe("dedupePendingDraftsByThread", () => {
  it("collapses 5 drafts from the same thread into 1 newest", () => {
    // Caller passes rows ORDER BY createdAt DESC, so the newest comes
    // first.
    const rows = [
      makeRow({
        id: "d5",
        inboxId: "i5",
        thread: "thread-1",
        createdAt: new Date("2026-05-05T12:00:00Z"),
        subject: "Re: hidden problem (5)",
      }),
      makeRow({
        id: "d4",
        inboxId: "i4",
        thread: "thread-1",
        createdAt: new Date("2026-05-04T12:00:00Z"),
        subject: "Re: hidden problem (4)",
      }),
      makeRow({
        id: "d3",
        inboxId: "i3",
        thread: "thread-1",
        createdAt: new Date("2026-05-03T12:00:00Z"),
        subject: "Re: hidden problem (3)",
      }),
      makeRow({
        id: "d2",
        inboxId: "i2",
        thread: "thread-1",
        createdAt: new Date("2026-05-02T12:00:00Z"),
        subject: "Re: hidden problem (2)",
      }),
      makeRow({
        id: "d1",
        inboxId: "i1",
        thread: "thread-1",
        createdAt: new Date("2026-05-01T12:00:00Z"),
        subject: "Re: hidden problem (1)",
      }),
    ];
    const out = dedupePendingDraftsByThread(rows);
    expect(out).toHaveLength(1);
    // Newest wins because the input order DESC + first-occurrence-wins.
    expect(out[0].draft.id).toBe("d5");
    expect(out[0].inbox.subject).toBe("Re: hidden problem (5)");
  });

  it("keeps drafts from different threads as separate rows", () => {
    const rows = [
      makeRow({
        id: "d-a",
        inboxId: "i-a",
        thread: "thread-A",
        createdAt: new Date("2026-05-05T12:00:00Z"),
        subject: "A",
      }),
      makeRow({
        id: "d-b",
        inboxId: "i-b",
        thread: "thread-B",
        createdAt: new Date("2026-05-05T11:00:00Z"),
        subject: "B",
      }),
      makeRow({
        id: "d-c",
        inboxId: "i-c",
        thread: "thread-C",
        createdAt: new Date("2026-05-05T10:00:00Z"),
        subject: "C",
      }),
    ];
    const out = dedupePendingDraftsByThread(rows);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.draft.id)).toEqual(["d-a", "d-b", "d-c"]);
  });

  it("preserves drafts with null threadExternalId (malformed headers)", () => {
    const rows = [
      makeRow({
        id: "d-1",
        inboxId: "i-1",
        thread: null,
        createdAt: new Date("2026-05-05T12:00:00Z"),
        subject: "no thread A",
      }),
      makeRow({
        id: "d-2",
        inboxId: "i-2",
        thread: null,
        createdAt: new Date("2026-05-05T11:00:00Z"),
        subject: "no thread B",
      }),
    ];
    const out = dedupePendingDraftsByThread(rows);
    // Both kept — no threadExternalId = no safe dedup key.
    expect(out).toHaveLength(2);
  });

  it("preserves order across mixed thread + nullable cases", () => {
    const rows = [
      makeRow({
        id: "d-newest-A",
        inboxId: "i1",
        thread: "thread-A",
        createdAt: new Date("2026-05-05T12:00:00Z"),
        subject: "A newer",
      }),
      makeRow({
        id: "d-null",
        inboxId: "i2",
        thread: null,
        createdAt: new Date("2026-05-05T11:00:00Z"),
        subject: "no thread",
      }),
      makeRow({
        id: "d-older-A",
        inboxId: "i3",
        thread: "thread-A",
        createdAt: new Date("2026-05-04T12:00:00Z"),
        subject: "A older — drops out",
      }),
      makeRow({
        id: "d-only-B",
        inboxId: "i4",
        thread: "thread-B",
        createdAt: new Date("2026-05-04T11:00:00Z"),
        subject: "B once",
      }),
    ];
    const out = dedupePendingDraftsByThread(rows);
    expect(out.map((r) => r.draft.id)).toEqual([
      "d-newest-A",
      "d-null",
      "d-only-B",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupePendingDraftsByThread([])).toEqual([]);
  });
});
