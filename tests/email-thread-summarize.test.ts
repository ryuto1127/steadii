import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-08 — chat agent thread summarizer. Plucks the "summarize this
// thread" feature from Shortwave / Apple Intelligence — single Gmail
// threads.get call, LLM distillation, returns overview + key points +
// participants. These tests pin the resolution flow (inboxItemId →
// threadExternalId), the threads.get → ThreadMessage shape, and the
// JSON contract from the LLM.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_o: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {
    id: {},
    userId: {},
    threadExternalId: {},
    deletedAt: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
}));

const fixture = {
  inboxRow: null as { threadExternalId: string | null } | null,
  threadMessages: [] as Array<{
    id: string;
    headers: Record<string, string>;
    body: string;
    internalDate: string | null;
  }>,
  ownEmail: "ryuto@example.com",
  llmResponse: {
    overview: "default overview",
    keyPoints: ["k1", "k2"],
  },
  llmThrows: false,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            fixture.inboxRow ? [fixture.inboxRow] : [],
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: async () => ({
    users: {
      threads: {
        get: async () => ({
          data: {
            messages: fixture.threadMessages,
          },
        }),
      },
      getProfile: async () => ({
        data: { emailAddress: fixture.ownEmail },
      }),
    },
  }),
}));

vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: (msg: { body?: string; __body?: string }) => ({
    text: msg.__body ?? msg.body ?? "",
    format: "text/plain" as const,
  }),
}));

vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  getHeader: (
    msg: { headers?: Record<string, string> },
    name: string
  ) => msg.headers?.[name] ?? null,
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

vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => {
          if (fixture.llmThrows) throw new Error("openai down");
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(fixture.llmResponse),
                },
              },
            ],
          };
        },
      },
    },
  }),
}));

beforeEach(() => {
  fixture.inboxRow = null;
  fixture.threadMessages = [];
  fixture.ownEmail = "ryuto@example.com";
  fixture.llmResponse = { overview: "default overview", keyPoints: ["k1", "k2"] };
  fixture.llmThrows = false;
});

describe("emailThreadSummarize", () => {
  it("resolves threadExternalId from inboxItemId, summarizes the thread", async () => {
    fixture.inboxRow = { threadExternalId: "th-100" };
    fixture.threadMessages = [
      {
        id: "m1",
        headers: {
          From: '"Prof X" <prof@uni.edu>',
          Subject: "Midterm prep",
        },
        body: "Reminder about Friday's midterm.",
        __body: "Reminder about Friday's midterm.",
        internalDate: String(new Date("2026-04-20T08:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
      {
        id: "m2",
        headers: {
          From: "<ryuto@example.com>",
          Subject: "Re: Midterm prep",
        },
        body: "Thanks — I'll review chapter 7.",
        __body: "Thanks — I'll review chapter 7.",
        internalDate: String(new Date("2026-04-20T10:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
      {
        id: "m3",
        headers: {
          From: '"Prof X" <prof@uni.edu>',
          Subject: "Re: Midterm prep",
        },
        body: "Great, see you Friday.",
        __body: "Great, see you Friday.",
        internalDate: String(new Date("2026-04-21T08:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
    ];
    fixture.llmResponse = {
      overview: "Confirms midterm prep for Friday.",
      keyPoints: [
        "Friday midterm",
        "Review chapter 7",
        "User confirmed attendance",
      ],
    };

    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    const result = await emailThreadSummarize.execute(
      { userId: "user-1" },
      { inboxItemId: "11111111-1111-4111-8111-111111111111" }
    );

    expect(result.threadExternalId).toBe("th-100");
    expect(result.messageCount).toBe(3);
    expect(result.overview).toBe("Confirms midterm prep for Friday.");
    expect(result.keyPoints).toHaveLength(3);
    expect(result.participants).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prof@uni.edu"),
        expect.stringContaining("ryuto@example.com"),
      ])
    );
    expect(result.firstSentAt).toBe("2026-04-20T08:00:00.000Z");
    expect(result.lastSentAt).toBe("2026-04-21T08:00:00.000Z");
  });

  it("accepts threadExternalId directly without inboxItemId", async () => {
    fixture.threadMessages = [
      {
        id: "m1",
        headers: { From: "<x@y.com>", Subject: "Hi" },
        body: "Hello.",
        __body: "Hello.",
        internalDate: String(new Date("2026-04-22T00:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
    ];

    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    const result = await emailThreadSummarize.execute(
      { userId: "user-1" },
      { threadExternalId: "th-direct" }
    );
    expect(result.threadExternalId).toBe("th-direct");
    expect(result.messageCount).toBe(1);
  });

  it("rejects empty args (must provide one of the ids)", async () => {
    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    await expect(
      emailThreadSummarize.execute({ userId: "user-1" }, {})
    ).rejects.toThrow();
  });

  it("throws when threadExternalId resolution fails (inbox row missing)", async () => {
    fixture.inboxRow = null;
    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    await expect(
      emailThreadSummarize.execute(
        { userId: "user-1" },
        { inboxItemId: "11111111-1111-4111-8111-111111111111" }
      )
    ).rejects.toThrow(/thread id/i);
  });

  it("throws when the thread has no messages", async () => {
    fixture.threadMessages = [];
    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    await expect(
      emailThreadSummarize.execute(
        { userId: "user-1" },
        { threadExternalId: "th-empty" }
      )
    ).rejects.toThrow(/no messages/i);
  });

  it("falls back to '(summary unavailable)' when LLM returns malformed JSON", async () => {
    fixture.threadMessages = [
      {
        id: "m1",
        headers: { From: "<x@y.com>", Subject: "Hi" },
        body: "Hello there.",
        __body: "Hello there.",
        internalDate: String(new Date("2026-04-22T00:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
    ];
    fixture.llmResponse = {
      overview: "" as unknown as string,
      keyPoints: [] as unknown as string[],
    };

    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    const result = await emailThreadSummarize.execute(
      { userId: "user-1" },
      { threadExternalId: "th-1" }
    );
    expect(result.overview).toBe("(summary unavailable)");
    expect(result.keyPoints).toEqual([]);
  });

  it("caps key points at 5 when LLM returns more", async () => {
    fixture.threadMessages = [
      {
        id: "m1",
        headers: { From: "<x@y.com>", Subject: "Hi" },
        body: "Hello.",
        __body: "Hello.",
        internalDate: String(new Date("2026-04-22T00:00:00Z").getTime()),
      } as unknown as (typeof fixture.threadMessages)[number],
    ];
    fixture.llmResponse = {
      overview: "ok",
      keyPoints: ["1", "2", "3", "4", "5", "6", "7"],
    };

    const { emailThreadSummarize } = await import(
      "@/lib/agent/tools/email-thread"
    );
    const result = await emailThreadSummarize.execute(
      { userId: "user-1" },
      { threadExternalId: "th-1" }
    );
    expect(result.keyPoints).toHaveLength(5);
  });
});
