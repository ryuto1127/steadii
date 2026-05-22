import { describe, expect, it, vi } from "vitest";

// 2026-05-22 — Coverage for the Type B Draft card's new `inboundSnippet`
// field. The field surfaces the inbound mail's snippet on the queue card
// so the user can decide Send in one click without navigating to
// /app/inbox/<id>.
//
// Tests target `draftToTypeB` (exported from lib/agent/queue/build.ts)
// directly. The builder for the Steadii-initiated office-hours request
// (`officeHoursToTypeB`) is a separate path with no inbound — its
// inboundSnippet is always null and isn't re-tested here, but the type
// system guarantees the field exists.

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
  draftToTypeB,
  type DraftWithInbox,
} from "@/lib/agent/queue/build";
import type {
  QueueCardBDraft,
  QueueCardBInformational,
} from "@/lib/agent/queue/types";

function makeRow(args: {
  snippet: string | null;
  draftBody?: string;
  subject?: string;
}): DraftWithInbox {
  return {
    draft: {
      id: "draft-1",
      userId: "user-1",
      inboxItemId: "inbox-1",
      action: "draft_reply",
      status: "pending",
      riskTier: "low",
      draftSubject: "re: subject",
      draftBody: args.draftBody ?? "draft body text",
      draftTo: ["recipient@example.com"],
      retrievalProvenance: null,
      shortSummary: null,
      createdAt: new Date("2026-05-22T12:00:00Z"),
    } as DraftWithInbox["draft"],
    inbox: {
      id: "inbox-1",
      senderName: "Sender",
      senderEmail: "sender@example.com",
      subject: args.subject ?? "subject",
      snippet: args.snippet,
    },
  };
}

function tShared(key: string): string {
  return key;
}

function asDraft(card: ReturnType<typeof draftToTypeB>): QueueCardBDraft {
  // The builder always returns the draft variant for draft_reply rows;
  // this narrow keeps the assertions type-safe.
  if (card.mode !== "draft") {
    throw new Error("expected draft variant");
  }
  return card;
}

describe("draftToTypeB — inboundSnippet pass-through", () => {
  it("includes the inbound snippet when inbox_items.snippet is non-null", () => {
    const row = makeRow({
      snippet:
        "Thanks for reaching out — happy to chat Wednesday afternoon. Slots are first-come.",
    });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBe(
      "Thanks for reaching out — happy to chat Wednesday afternoon. Slots are first-come."
    );
  });

  it("returns null when inbox_items.snippet is null", () => {
    const row = makeRow({ snippet: null });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBeNull();
  });

  it("returns null when inbox_items.snippet is only whitespace", () => {
    const row = makeRow({ snippet: "   \n\t  " });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBeNull();
  });

  it("collapses internal whitespace runs to single spaces", () => {
    const row = makeRow({
      snippet: "line one\n\nline two\t\tline three",
    });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBe("line one line two line three");
  });
});

describe("draftToTypeB — truncation at 200 chars", () => {
  it("leaves short snippets untouched (no ellipsis appended)", () => {
    const row = makeRow({ snippet: "exactly 200 chars or fewer" });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBe("exactly 200 chars or fewer");
    expect(card.inboundSnippet?.endsWith("…")).toBe(false);
  });

  it("leaves a snippet of exactly 200 chars untouched", () => {
    const exactly200 = "x".repeat(200);
    const row = makeRow({ snippet: exactly200 });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).toBe(exactly200);
    expect(card.inboundSnippet?.length).toBe(200);
  });

  it("truncates snippets longer than 200 chars and appends an ellipsis", () => {
    const longSnippet = "x".repeat(500);
    const row = makeRow({ snippet: longSnippet });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).not.toBeNull();
    expect(card.inboundSnippet!.length).toBe(200);
    expect(card.inboundSnippet!.endsWith("…")).toBe(true);
    expect(card.inboundSnippet!.startsWith("xxxxxxxx")).toBe(true);
  });

  it("normalises whitespace BEFORE measuring the 200-char ceiling", () => {
    // 250 chars of "ab " repeated → after collapse, still 250 chars.
    // Without normalisation we'd risk a snippet that looks short but
    // truncates mid-word; with it, the length check is on the rendered form.
    const noisy = ("ab\n\n").repeat(75); // 300 chars raw, 224 chars after collapse to "ab " * 75
    const row = makeRow({ snippet: noisy });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.inboundSnippet).not.toBeNull();
    expect(card.inboundSnippet!.length).toBeLessThanOrEqual(200);
    expect(card.inboundSnippet!.endsWith("…")).toBe(true);
  });
});

describe("draftToTypeB — adjacent fields untouched", () => {
  it("preserves the existing draftPreview / subjectLine / toLabel fields", () => {
    const row = makeRow({
      snippet: "inbound preview",
      draftBody: "Steadii drafted reply body",
      subject: "Original subject",
    });
    const card = asDraft(draftToTypeB(row, tShared));
    expect(card.draftPreview).toContain("Steadii drafted reply body");
    expect(card.subjectLine).toBe("re: subject"); // draft.draftSubject wins
    expect(card.toLabel).toBe("To: recipient@example.com");
  });
});

describe("QueueCardBInformational — unaffected by this change", () => {
  it("is a structurally distinct type — no inboundSnippet field on the informational variant", () => {
    // Construct a minimal informational card via the type system to
    // assert the field is not present. If a future change to the union
    // accidentally adds inboundSnippet to the informational variant,
    // this test will fail to compile.
    const informational: QueueCardBInformational = {
      id: "pre_brief:1",
      archetype: "B",
      mode: "informational",
      title: "Meeting in 15 min",
      body: "context",
      confidence: "high",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: false,
      bullets: ["bullet one", "bullet two"],
      secondaryActions: [],
    };

    // @ts-expect-error — inboundSnippet must NOT exist on the
    // informational variant. If this becomes valid, the type drift
    // is a bug and the test failure is the signal.
    informational.inboundSnippet;

    expect(informational.mode).toBe("informational");
  });
});
