import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-49 — server-action tests for the agent-tuning settings page.
// The actions wrap the learner helpers; we mock the learner layer and
// verify the action correctly routes user-scoped IDs through. Zod
// validation is exercised by passing bad FormData payloads.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

// Revalidate is a no-op stub.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Mock the auth helper. Provides a consistent user id so the action's
// SQL writes are scoped to "u1".
vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1" } })),
}));

// Mock the learner module so the action's surface area is the only
// thing tested. The mocks capture invocations for assertion.
type AnyArgs = unknown[];
const revokePromotionMock = vi.fn((..._args: AnyArgs) => Promise.resolve(true));
const forgiveSenderMock = vi.fn((..._args: AnyArgs) => Promise.resolve(true));
const resetAllMock = vi.fn((..._args: AnyArgs) => Promise.resolve(7));
vi.mock("@/lib/agent/learning/sender-confidence", () => ({
  revokePromotion: (args: unknown) => revokePromotionMock(args),
  forgiveSender: (args: unknown) => forgiveSenderMock(args),
  resetAllSenderConfidence: (userId: string) => resetAllMock(userId),
}));

import {
  revokePromotionAction,
  forgiveSenderAction,
  resetAllSenderConfidenceAction,
} from "@/app/app/settings/agent-tuning/actions";

function makeForm(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("revokePromotionAction", () => {
  beforeEach(() => {
    revokePromotionMock.mockClear();
  });

  it("routes the sender + action to revokePromotion under the auth'd userId", async () => {
    await revokePromotionAction(
      makeForm({
        sender_email: "Mentor@example.com",
        action_type: "draft_reply",
      })
    );
    expect(revokePromotionMock).toHaveBeenCalledTimes(1);
    expect(revokePromotionMock).toHaveBeenCalledWith({
      userId: "u1",
      senderEmail: "Mentor@example.com",
      actionType: "draft_reply",
    });
  });

  it("rejects invalid sender_email", async () => {
    await expect(
      revokePromotionAction(
        makeForm({ sender_email: "not-an-email", action_type: "draft_reply" })
      )
    ).rejects.toThrow();
    expect(revokePromotionMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown action_type", async () => {
    await expect(
      revokePromotionAction(
        makeForm({ sender_email: "a@b.com", action_type: "frobnicate" })
      )
    ).rejects.toThrow();
    expect(revokePromotionMock).not.toHaveBeenCalled();
  });
});

describe("forgiveSenderAction", () => {
  beforeEach(() => {
    forgiveSenderMock.mockClear();
  });

  it("routes the sender + action to forgiveSender", async () => {
    await forgiveSenderAction(
      makeForm({
        sender_email: "noisy@example.com",
        action_type: "notify_only",
      })
    );
    expect(forgiveSenderMock).toHaveBeenCalledWith({
      userId: "u1",
      senderEmail: "noisy@example.com",
      actionType: "notify_only",
    });
  });
});

describe("resetAllSenderConfidenceAction", () => {
  beforeEach(() => {
    resetAllMock.mockClear();
  });

  it("invokes resetAllSenderConfidence with the auth'd userId", async () => {
    await resetAllSenderConfidenceAction();
    expect(resetAllMock).toHaveBeenCalledTimes(1);
    expect(resetAllMock).toHaveBeenCalledWith("u1");
  });
});
