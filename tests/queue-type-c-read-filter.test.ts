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

describe("shouldHideReadNotifyOnly", () => {
  it("never hides draft_reply, ask_clarifying, or other non-notify actions", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "draft_reply",
          gmailReadAt: new Date(NOW.getTime() - 48 * HOUR),
        }),
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

  it("keeps notify_only items visible when no read signal exists", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({ action: "notify_only", gmailReadAt: null }),
        NOW
      )
    ).toBe(false);
  });

  it("keeps just-read notify_only items visible during the 24h grace window", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 1 * HOUR),
        }),
        NOW
      )
    ).toBe(false);
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 23 * HOUR),
        }),
        NOW
      )
    ).toBe(false);
  });

  it("hides notify_only items read more than 24h ago", () => {
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 25 * HOUR),
        }),
        NOW
      )
    ).toBe(true);
    expect(
      shouldHideReadNotifyOnly(
        row({
          action: "notify_only",
          gmailReadAt: new Date(NOW.getTime() - 7 * 24 * HOUR),
        }),
        NOW
      )
    ).toBe(true);
  });
});
