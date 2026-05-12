import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_GOOGLE_ID: "g",
    AUTH_GOOGLE_SECRET: "s",
    ENCRYPTION_KEY: "k".repeat(64),
    NODE_ENV: "test",
  }),
}));

// Capture createAssignment calls — that's the integration boundary we
// care about. The save helper itself is tested in `lib/assignments/save.ts`'s
// own suite.
const createAssignmentCalls: Array<{
  userId: string;
  input: Record<string, unknown>;
}> = [];

vi.mock("@/lib/assignments/save", () => ({
  createAssignment: async (args: {
    userId: string;
    input: Record<string, unknown>;
  }) => {
    createAssignmentCalls.push(args);
    return { id: `asg-${createAssignmentCalls.length}` };
  },
}));

vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

// Drive class-resolution via a controllable list. Each test sets
// `classRows` to whatever the DB should "return" for the LIKE/eq query.
let classRows: Array<{ id: string; createdAt: Date }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => classRows,
          }),
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  or: () => ({}),
  desc: () => ({}),
  sql: ((...parts: unknown[]) => parts) as unknown as object,
}));

vi.mock("@/lib/db/schema", () => ({
  classes: {
    id: { __col: "id" },
    name: { __col: "name" },
    code: { __col: "code" },
    userId: { __col: "user_id" },
    status: { __col: "status" },
    deletedAt: { __col: "deleted_at" },
    createdAt: { __col: "created_at" },
  },
}));

import { assignmentsCreate } from "@/lib/agent/tools/assignments";

beforeEach(() => {
  createAssignmentCalls.length = 0;
  classRows = [];
});

describe("assignments_create tool", () => {
  it("parses an ISO date and inserts via createAssignment", async () => {
    const result = await assignmentsCreate.execute(
      { userId: "u1" },
      { title: "Essay 3", due: "2026-06-15" }
    );
    expect(result.id).toBe("asg-1");
    expect(result.classId).toBeNull();
    expect(result.classMatched).toBe(false);
    expect(createAssignmentCalls).toHaveLength(1);
    const call = createAssignmentCalls[0];
    expect(call.userId).toBe("u1");
    expect(call.input.title).toBe("Essay 3");
    expect(call.input.status).toBe("not_started");
    expect(call.input.source).toBe("chat");
    expect(call.input.classId).toBeNull();
    // Date-only inputs become EOD local — verify the ISO came through
    expect(typeof call.input.dueAt).toBe("string");
    expect((call.input.dueAt as string).startsWith("2026-06-")).toBe(true);
  });

  it("parses 'next Friday' and resolves to a future Friday", async () => {
    // 2026-05-12 is a Tuesday — "next Friday" should resolve to 2026-05-22
    // (the Friday in the following week per the parser's next-week rule).
    const fixedNow = new Date("2026-05-12T18:00:00Z");
    vi.setSystemTime(fixedNow);
    try {
      await assignmentsCreate.execute(
        { userId: "u1" },
        { title: "Bio test", due: "next Friday" }
      );
      const dueIso = createAssignmentCalls[0].input.dueAt as string;
      const due = new Date(dueIso);
      // Friday is dow=5
      // Compute the local-Friday in the user's tz (Vancouver), which we
      // can verify is the correct date. The parser pins time to EOD
      // local — so the resulting UTC instant should be later than the
      // UTC midnight of the local Friday.
      expect(dueIso.startsWith("2026-05-22") || dueIso.startsWith("2026-05-23")).toBe(true);
      // It must be strictly in the future
      expect(due.getTime()).toBeGreaterThan(fixedNow.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses '来週水曜' (JA: next-week Wednesday)", async () => {
    // 2026-05-12 is a Tuesday — 来週水曜 = the Wednesday in the *following*
    // calendar week per the parser's "next-week" mode.
    const fixedNow = new Date("2026-05-12T18:00:00Z");
    vi.setSystemTime(fixedNow);
    try {
      await assignmentsCreate.execute(
        { userId: "u1" },
        { title: "英作文", due: "来週水曜" }
      );
      const dueIso = createAssignmentCalls[0].input.dueAt as string;
      const due = new Date(dueIso);
      expect(due.getTime()).toBeGreaterThan(fixedNow.getTime());
      // Verify it's at least a week out
      const deltaDays = (due.getTime() - fixedNow.getTime()) / (86400 * 1000);
      expect(deltaDays).toBeGreaterThanOrEqual(6);
      expect(deltaDays).toBeLessThanOrEqual(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches a class by name (case-insensitive substring)", async () => {
    classRows = [
      { id: "cls-bio", createdAt: new Date("2026-01-01T00:00:00Z") },
    ];
    const result = await assignmentsCreate.execute(
      { userId: "u1" },
      {
        title: "Bio test",
        due: "2026-06-15",
        classHint: "Bio",
      }
    );
    expect(result.classMatched).toBe(true);
    expect(result.classId).toBe("cls-bio");
    expect(createAssignmentCalls[0].input.classId).toBe("cls-bio");
  });

  it("leaves classId null when no class matches the hint", async () => {
    classRows = [];
    const result = await assignmentsCreate.execute(
      { userId: "u1" },
      {
        title: "Random",
        due: "2026-06-15",
        classHint: "Underwater Basket Weaving",
      }
    );
    expect(result.classMatched).toBe(false);
    expect(result.classId).toBeNull();
    expect(createAssignmentCalls[0].input.classId).toBeNull();
  });

  it("defaults status='not_started' and source='chat'", async () => {
    await assignmentsCreate.execute(
      { userId: "u1" },
      { title: "x", due: "2026-06-15" }
    );
    expect(createAssignmentCalls[0].input.status).toBe("not_started");
    expect(createAssignmentCalls[0].input.source).toBe("chat");
  });

  it("propagates priority and notes when provided", async () => {
    await assignmentsCreate.execute(
      { userId: "u1" },
      {
        title: "x",
        due: "2026-06-15",
        priority: "high",
        notes: "spec doc attached",
      }
    );
    expect(createAssignmentCalls[0].input.priority).toBe("high");
    expect(createAssignmentCalls[0].input.notes).toBe("spec doc attached");
  });

  it("throws a helpful error when the due string is unparseable", async () => {
    await expect(
      assignmentsCreate.execute(
        { userId: "u1" },
        { title: "x", due: "purple monkey dishwasher" }
      )
    ).rejects.toThrow(/Could not parse due date/);
    expect(createAssignmentCalls).toHaveLength(0);
  });
});
