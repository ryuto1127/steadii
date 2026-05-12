import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ users: {} }));
vi.mock("drizzle-orm", () => {
  const id = (..._args: unknown[]) => ({});
  return { and: id, eq: id };
});
vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: vi.fn(),
}));

// Default env mock with both Pub/Sub halves populated. The test below
// for "missing project" / "missing topic" re-mocks @/lib/env with
// vi.doMock + vi.resetModules + dynamic import to swap in the partial
// configs without polluting the other tests in the file.
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
    GMAIL_PUBSUB_PROJECT: "steadii-prod",
    GMAIL_PUBSUB_TOPIC: "gmail-push-prod",
    GMAIL_PUSH_VERIFICATION_TOKEN: "",
  }),
}));

import { _internal } from "@/lib/integrations/google/gmail-watch";

describe("resolveTopicName", () => {
  it("composes the full topic name when both halves are set", () => {
    expect(_internal.resolveTopicName()).toBe(
      "projects/steadii-prod/topics/gmail-push-prod"
    );
  });
});

describe("REFRESH_THRESHOLD_MS", () => {
  it("is exactly 24 hours so the daily cron has a full retry window", () => {
    expect(_internal.REFRESH_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
  });
});
