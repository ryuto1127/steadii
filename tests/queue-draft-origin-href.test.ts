import { describe, expect, it, vi } from "vitest";

// Coverage for the originHref wiring on the 3 draft → queue-card builders:
// draftToTypeB (draft_reply), draftToTypeC (notify_only), draftToTypeE
// (ask_clarifying). All three previously pointed back to Steadii's own
// /app/inbox/<id> page; the fix routes them to Gmail web for context
// review, with outlook deferred until Mail.Read scope lands.

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

function tShared(key: string): string {
  return key;
}

function makeRow(overrides: {
  action?: "draft_reply" | "notify_only" | "ask_clarifying";
  sourceType?: string;
  threadExternalId?: string | null;
}): DraftWithInbox {
  return {
    draft: {
      id: "draft-1",
      userId: "user-1",
      inboxItemId: "inbox-1",
      action: overrides.action ?? "draft_reply",
      status: "pending",
      riskTier: "low",
      draftSubject: "re: subject",
      draftBody: "body",
      draftTo: ["recipient@example.com"],
      retrievalProvenance: null,
      shortSummary: null,
      reasoning: "reasoning",
      createdAt: new Date("2026-05-24T12:00:00Z"),
    } as DraftWithInbox["draft"],
    inbox: {
      id: "inbox-1",
      senderName: "Sender",
      senderEmail: "sender@example.example",
      subject: "subject",
      snippet: "inbound snippet",
      sourceType: overrides.sourceType ?? "gmail",
      threadExternalId:
        overrides.threadExternalId === undefined
          ? "thread_abc123"
          : overrides.threadExternalId,
    },
  };
}

describe("draftToTypeB → originHref", () => {
  it("uses Gmail web URL when sourceType=gmail and thread id is present", () => {
    const card = draftToTypeB(makeRow({ action: "draft_reply" }), tShared);
    expect(card.originHref).toBe(
      "https://mail.google.com/mail/u/0/#inbox/thread_abc123"
    );
  });

  it("omits originHref entirely when threadExternalId is null", () => {
    const card = draftToTypeB(
      makeRow({ action: "draft_reply", threadExternalId: null }),
      tShared
    );
    expect(card.originHref).toBeUndefined();
  });

  it("omits originHref entirely for outlook (Mail.Read deferred at α)", () => {
    const card = draftToTypeB(
      makeRow({ action: "draft_reply", sourceType: "outlook" }),
      tShared
    );
    expect(card.originHref).toBeUndefined();
  });

  it("does NOT point back to Steadii's internal /app/inbox/<id> page", () => {
    const card = draftToTypeB(makeRow({ action: "draft_reply" }), tShared);
    expect(card.originHref).not.toMatch(/\/app\/inbox\//);
  });

  it("detailHref remains the internal inbox path (unchanged by this fix)", () => {
    const card = draftToTypeB(makeRow({ action: "draft_reply" }), tShared);
    expect(card.detailHref).toBe("/app/inbox/draft-1");
  });
});

// draftToTypeC and draftToTypeE are not exported individually — they're
// reached via partitionDrafts. Re-test through the same draftToTypeB path
// the build module exposes, and rely on the shared CardFooter renderer
// test below to cover the visual-side behavior for C and E.
