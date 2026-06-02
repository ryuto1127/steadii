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

  // MIME correctness for multi-byte UTF-8 (Japanese) bodies. A multi-line
  // JA body is now common after the register-conditioned 改行 prompt rule,
  // so the wire format has to declare 8bit, use CRLF line endings, and
  // round-trip the Japanese characters intact.
  describe("UTF-8 Japanese multi-line body", () => {
    // Greeting / blank line / two body lines / blank line / closing —
    // the formal JA block shape. Placeholder name only.
    const jaBody = [
      "お世話になっております。田中太郎です。",
      "",
      "ご連絡いただいた件、確認いたしました。",
      "ご提示の日程で問題ございません。",
      "",
      "引き続きどうぞよろしくお願いいたします。",
    ].join("\n");

    it("declares Content-Transfer-Encoding: 8bit (not 7bit)", () => {
      const raw = encodeGmailRaw({
        to: ["a@example.com"],
        subject: "件名",
        body: jaBody,
      });
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      expect(decoded).toContain("Content-Transfer-Encoding: 8bit");
      expect(decoded).not.toContain("Content-Transfer-Encoding: 7bit");
    });

    it("normalizes body line endings to CRLF (no lone \\n)", () => {
      const raw = encodeGmailRaw({
        to: ["a@example.com"],
        subject: "件名",
        body: jaBody,
      });
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      // Isolate the body (after the blank line separating headers).
      const body = decoded.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      expect(body.length).toBeGreaterThan(0);
      // Every \n in the body must be immediately preceded by \r.
      expect(/(?<!\r)\n/.test(body)).toBe(false);
      // And the multi-line structure survived as CRLF.
      expect(body).toContain(
        "ご連絡いただいた件、確認いたしました。\r\nご提示の日程で問題ございません。"
      );
    });

    it("does not double-convert a body that already uses CRLF", () => {
      const crlfBody = "一行目\r\n二行目";
      const raw = encodeGmailRaw({
        to: ["a@example.com"],
        subject: "件名",
        body: crlfBody,
      });
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      expect(decoded).toContain("一行目\r\n二行目");
      expect(decoded).not.toContain("一行目\r\r\n二行目");
    });

    it("round-trips the Japanese characters intact through base64", () => {
      const raw = encodeGmailRaw({
        to: ["a@example.com"],
        subject: "件名",
        body: jaBody,
      });
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      // Each line's Japanese content survived UTF-8 → base64 → UTF-8.
      for (const line of jaBody.split("\n")) {
        if (line.length === 0) continue;
        expect(decoded).toContain(line);
      }
    });
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
