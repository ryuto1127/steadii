import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeGmailRaw } from "@/lib/agent/tools/gmail";

// Mock the Gmail API factory so tests never touch the real google SDK.
const draftsCreateSpy = vi.fn();
const draftsSendSpy = vi.fn();
const draftsDeleteSpy = vi.fn();

vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: async () => ({
    users: {
      drafts: {
        create: draftsCreateSpy,
        send: draftsSendSpy,
        delete: draftsDeleteSpy,
      },
    },
  }),
  GmailNotConnectedError: class extends Error {
    code = "GMAIL_NOT_CONNECTED" as const;
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: () => {},
}));

vi.mock("@/lib/db/client", () => ({
  db: { insert: () => ({ values: async () => {} }) },
}));
vi.mock("@/lib/db/schema", () => ({ auditLog: {} }));

beforeEach(() => {
  draftsCreateSpy.mockReset();
  draftsSendSpy.mockReset();
  draftsDeleteSpy.mockReset();
});

describe("encodeGmailRaw", () => {
  it("produces url-safe base64 RFC 2822 content with To/Subject", () => {
    const raw = encodeGmailRaw({
      to: ["a@example.com"],
      subject: "Hello",
      body: "Body line",
    });
    // Base64-url shouldn't contain +, /, or padding
    expect(raw).not.toMatch(/[+/]/);
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Body line");
  });

  it("encodes non-ASCII subjects as RFC 2047", () => {
    const raw = encodeGmailRaw({
      to: ["a@example.com"],
      subject: "こんにちは",
      body: "x",
    });
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("includes In-Reply-To and References when given", () => {
    const raw = encodeGmailRaw({
      to: ["a@example.com"],
      subject: "S",
      body: "B",
      inReplyTo: "<abc@gmail.com>",
    });
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    expect(decoded).toContain("In-Reply-To: <abc@gmail.com>");
    expect(decoded).toContain("References: <abc@gmail.com>");
  });
});

describe("gmailSendTool.execute (mocked Gmail API)", () => {
  it("creates a draft via users.drafts.create and returns the ids", async () => {
    draftsCreateSpy.mockResolvedValue({
      data: { id: "draft-1", message: { id: "msg-1" } },
    });
    const { gmailSendTool } = await import("@/lib/agent/tools/gmail");
    const res = await gmailSendTool.execute(
      { userId: "u1" },
      { to: ["a@b.com"], subject: "S", body: "B" }
    );
    expect(res).toEqual({ gmailDraftId: "draft-1", gmailMessageId: "msg-1" });
    expect(draftsCreateSpy).toHaveBeenCalledOnce();
    const call = draftsCreateSpy.mock.calls[0][0];
    expect(call.userId).toBe("me");
    expect(call.requestBody.message.raw).toBeTruthy();
  });

  it("surfaces a wrapped GmailDraftCreationError when Gmail throws", async () => {
    draftsCreateSpy.mockRejectedValue(new Error("boom"));
    const { gmailSendTool } = await import("@/lib/agent/tools/gmail");
    await expect(
      gmailSendTool.execute(
        { userId: "u1" },
        { to: ["a@b.com"], subject: "S", body: "B" }
      )
    ).rejects.toMatchObject({ code: "GMAIL_DRAFT_CREATE_FAILED" });
  });
});
