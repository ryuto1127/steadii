import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-08 — per-message similar-content sent retrieval. Voice
// profile (engineer-38) summarises global style in 200 chars; sender
// history covers same-recipient continuity. This loader fills the gap:
// "first-time recipient, but Ryuto has written lots of similar-context
// emails before." Heuristic via Gmail's native search (no embeddings
// yet) — these tests pin down the keyword extraction shape and the
// dedup-against-current-recipient behavior.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_o: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

const listMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: async () => ({
    users: {
      messages: {
        list: listMock,
        get: getMock,
      },
    },
  }),
}));

vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: (msg: unknown) => ({
    text: (msg as { __body?: string }).__body ?? "",
    format: "text/plain" as const,
  }),
}));

vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  getHeader: (msg: { headers?: Record<string, string> }, name: string) =>
    msg.headers?.[name] ?? null,
  parseAddress: (raw: string | null | undefined) => {
    if (!raw) return { email: "", name: null };
    const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(raw.trim());
    if (m) {
      return {
        email: m[2]!.trim(),
        name: (m[1] ?? "").trim() || null,
      };
    }
    return { email: raw.trim(), name: null };
  },
}));

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
});

describe("extractKeywords", () => {
  it("picks up to 3 distinctive subject tokens", async () => {
    const { extractKeywords } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = extractKeywords(
      "Re: Midterm prep questions for MAT223",
      null
    );
    expect(out.length).toBeLessThanOrEqual(3);
    // "re" is a stopword, "for" too — should drop them.
    expect(out.some((t) => t.toLowerCase() === "re")).toBe(false);
    expect(out.some((t) => t.toLowerCase() === "for")).toBe(false);
    // Distinctive tokens survive.
    expect(out).toEqual(expect.arrayContaining(["Midterm"]));
  });

  it("falls back to snippet tokens when subject is empty", async () => {
    const { extractKeywords } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = extractKeywords(null, "Reminder about chapter 7 reading.");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toEqual(
      expect.arrayContaining(["chapter"])
    );
  });

  it("preserves CJK runs as whole tokens", async () => {
    const { extractKeywords } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = extractKeywords("数学の midterm 準備", null);
    // 「数学の」 stays as a single token; ASCII "midterm" also picked.
    expect(out).toEqual(expect.arrayContaining(["midterm"]));
  });

  it("returns empty when nothing distinctive remains", async () => {
    const { extractKeywords } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    expect(extractKeywords("Hi", null)).toEqual([]);
    expect(extractKeywords(null, null)).toEqual([]);
  });
});

describe("findSimilarSentEmails", () => {
  it("returns top K past sent emails matching subject keywords", async () => {
    listMock.mockResolvedValueOnce({
      data: {
        messages: [{ id: "m1" }, { id: "m2" }],
      },
    });
    getMock
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-22").getTime()),
          headers: { Subject: "Re: midterm prep", To: "<other@x.edu>" },
          __body: "Thanks — I'll review chapter 7 tonight.",
        },
      })
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-15").getTime()),
          headers: {
            Subject: "Re: midterm timing",
            To: '"Tutor" <tutor@x.edu>',
          },
          __body: "Sounds good — I can do Friday afternoon.",
        },
      });

    const { findSimilarSentEmails } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = await findSimilarSentEmails({
      userId: "u1",
      subject: "Midterm prep questions",
      snippet: null,
      excludeRecipientEmail: null,
      k: 3,
    });

    expect(out.length).toBe(2);
    expect(out[0].subject).toBe("Re: midterm prep");
    expect(out[0].body).toMatch(/chapter 7/);
    expect(out[1].recipientName).toBe("Tutor");
  });

  it("excludes the same-recipient hits (already covered by senderHistory)", async () => {
    listMock.mockResolvedValueOnce({
      data: { messages: [{ id: "same" }, { id: "other" }] },
    });
    getMock
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-22").getTime()),
          headers: {
            Subject: "Re: same recipient",
            To: '"Prof" <prof@x.edu>',
          },
          __body: "Reply to the SAME prof.",
        },
      })
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-15").getTime()),
          headers: { Subject: "Re: other", To: "different@y.edu" },
          __body: "Reply to a different recipient.",
        },
      });

    const { findSimilarSentEmails } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = await findSimilarSentEmails({
      userId: "u1",
      subject: "Question for prof",
      snippet: null,
      excludeRecipientEmail: "prof@x.edu",
      k: 3,
    });

    expect(out.length).toBe(1);
    expect(out[0].recipientEmail).toBe("different@y.edu");
  });

  it("returns empty when no keywords can be extracted", async () => {
    const { findSimilarSentEmails } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = await findSimilarSentEmails({
      userId: "u1",
      subject: "Hi",
      snippet: null,
      excludeRecipientEmail: null,
      k: 3,
    });
    expect(out).toEqual([]);
    // Gmail list never called — short-circuited at keyword check.
    expect(listMock).not.toHaveBeenCalled();
  });

  it("swallows Gmail list failure gracefully and returns []", async () => {
    listMock.mockRejectedValueOnce(new Error("gmail down"));
    const { findSimilarSentEmails } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = await findSimilarSentEmails({
      userId: "u1",
      subject: "Midterm prep questions",
      snippet: null,
      excludeRecipientEmail: null,
      k: 3,
    });
    expect(out).toEqual([]);
  });

  it("skips messages with empty bodies (forwarded-only / quote-only noise)", async () => {
    listMock.mockResolvedValueOnce({
      data: { messages: [{ id: "m1" }, { id: "m2" }] },
    });
    getMock
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-22").getTime()),
          headers: { Subject: "Empty", To: "x@y.com" },
          __body: "",
        },
      })
      .mockResolvedValueOnce({
        data: {
          internalDate: String(new Date("2026-04-15").getTime()),
          headers: { Subject: "Real", To: "x@y.com" },
          __body: "Real reply with actual content.",
        },
      });

    const { findSimilarSentEmails } = await import(
      "@/lib/agent/email/similar-sent-retrieval"
    );
    const out = await findSimilarSentEmails({
      userId: "u1",
      subject: "Midterm prep questions",
      snippet: null,
      excludeRecipientEmail: null,
      k: 3,
    });
    expect(out.length).toBe(1);
    expect(out[0].subject).toBe("Real");
  });
});
