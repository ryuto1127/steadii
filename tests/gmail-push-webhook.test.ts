import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  inboxItems: {},
  users: {},
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ GMAIL_PUSH_VERIFICATION_TOKEN: "" }),
}));
vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: vi.fn(),
}));
vi.mock("drizzle-orm", () => {
  const id = (..._args: unknown[]) => ({});
  return {
    and: id,
    eq: id,
  };
});

import { decodePubSubPayload } from "@/app/api/webhooks/gmail-push/route";

describe("decodePubSubPayload", () => {
  it("decodes a well-formed Pub/Sub envelope", () => {
    const inner = { emailAddress: "ryuto@school.edu", historyId: "12345" };
    const envelope = {
      message: {
        data: Buffer.from(JSON.stringify(inner)).toString("base64"),
        messageId: "msg-1",
        publishTime: "2026-05-11T18:00:00Z",
      },
      subscription: "projects/p/subscriptions/s",
    };
    expect(decodePubSubPayload(envelope)).toEqual(inner);
  });

  it("accepts numeric historyId", () => {
    const inner = { emailAddress: "ryuto@school.edu", historyId: 9999 };
    const envelope = {
      message: { data: Buffer.from(JSON.stringify(inner)).toString("base64") },
    };
    expect(decodePubSubPayload(envelope)).toEqual(inner);
  });

  it("returns null on missing data field", () => {
    expect(decodePubSubPayload({})).toBeNull();
    expect(decodePubSubPayload({ message: {} })).toBeNull();
  });

  it("returns null on malformed base64 / JSON", () => {
    expect(
      decodePubSubPayload({ message: { data: "not-base64-json!@#$" } })
    ).toBeNull();
    expect(
      decodePubSubPayload({
        message: { data: Buffer.from("not json").toString("base64") },
      })
    ).toBeNull();
  });

  it("returns null when emailAddress or historyId is missing", () => {
    const noEmail = {
      message: {
        data: Buffer.from(JSON.stringify({ historyId: "1" })).toString("base64"),
      },
    };
    const noHistory = {
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: "x@y.com" })
        ).toString("base64"),
      },
    };
    expect(decodePubSubPayload(noEmail)).toBeNull();
    expect(decodePubSubPayload(noHistory)).toBeNull();
  });
});
