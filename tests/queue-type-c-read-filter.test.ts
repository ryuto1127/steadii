import { describe, expect, it, vi } from "vitest";

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

import { shouldHideReadNotifyOnly } from "@/lib/agent/queue/build";
import type { AgentDraft } from "@/lib/db/schema";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-05-11T18:00:00Z");

function row(args: {
  action: AgentDraft["action"];
  gmailReadAt: Date | null;
}): {
  draft: { action: AgentDraft["action"] };
  gmailReadAt: Date | null;
} {
  return {
    draft: { action: args.action },
    gmailReadAt: args.gmailReadAt,
  };
}

// Inclusion rule: the judgment queue holds ONLY items that still need the
// user's decision. notify_only ("返信不要" / FYI) cards owe no judgment
// once the underlying Gmail message is READ, so they leave the queue
// immediately (TYPE_C_READ_GRACE_HOURS = 0) — they live on in Recent
// Activity. Action-required actions (draft_reply / ask_clarifying) are
// NEVER hidden by a read signal.
describe("shouldHideReadNotifyOnly", () => {
  it("never hides draft_reply or ask_clarifying regardless of read state", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "draft_reply",
          gmailReadAt: new Date(NOW.getTime() - 48 * HOUR),
        }),
        NOW
      )
    ).toBe(false);
    // Even read this very instant, a draft_reply stays — it owes a
    // send decision, "read in Gmail" is not "handled".
    expect(
      shouldHideReadNotifyOnly(
        row({ action: "draft_reply", gmailReadAt: NOW }),
        NOW
      )
    ).toBe(false);
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "ask_clarifying",
          gmailReadAt: new Date(NOW.getTime() - 48 * HOUR),
        }),
        NOW
      )
    ).toBe(false);
  });

  it("keeps an UNREAD notify_only card in the queue (no read signal)", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({ action: "notify_only", gmailReadAt: null }),
        NOW
      )
    ).toBe(false);
  });

  it("hides a notify_only card the moment it is read (immediate)", () => {
    // Read exactly now → hidden (no 24h tail anymore).
    expect(
      shouldHideReadNotifyOnly(
        row({ action: "notify_only", gmailReadAt: NOW }),
        NOW
      )
    ).toBe(true);
    // Read a minute ago → hidden.
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 60 * 1000),
        }),
        NOW
      )
    ).toBe(true);
    // Read an hour ago (INSIDE the old 24h grace) → now hidden.
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 1 * HOUR),
        }),
        NOW
      )
    ).toBe(true);
    // Read a day ago → still hidden (this was the original bug: a card
    // read "1日前" lingering in the queue under the 24h grace).
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 25 * HOUR),
        }),
        NOW
      )
    ).toBe(true);
  });
});
