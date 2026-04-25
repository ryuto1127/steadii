import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
    OPENAI_API_KEY: "sk-test",
  }),
}));

vi.mock("@/lib/integrations/google/calendar", () => ({
  getCalendarForUser: async () => {
    throw new Error("not used in this test");
  },
  CalendarNotConnectedError: class {},
}));

const state: {
  rows: Array<{
    id: string;
    title: string;
    dueAt: Date | null;
    classId: string | null;
    classTitle: string | null;
    classColor: string | null;
  }>;
} = { rows: [] };

vi.mock("@/lib/db/client", () => {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then(...a: Parameters<Promise<unknown>["then"]>) {
      return Promise.resolve(state.rows).then(...a);
    },
    catch: () => Promise.resolve([]),
    finally: () => Promise.resolve([]),
  };
  return {
    db: { select: () => chain },
  };
});

import { getDueSoonAssignments } from "@/lib/dashboard/today";

describe("getDueSoonAssignments (Postgres)", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it("returns empty list when there are no rows", async () => {
    const out = await getDueSoonAssignments("u1");
    expect(out).toEqual([]);
  });

  it("maps Postgres rows to the DueSoonAssignment shape", async () => {
    state.rows = [
      {
        id: "a1",
        title: "Physics PS4",
        dueAt: new Date("2026-04-26T10:00:00Z"),
        classId: "c1",
        classTitle: "Physics 101",
        classColor: "blue",
      },
    ];
    const out = await getDueSoonAssignments("u1");
    expect(out).toEqual([
      {
        id: "a1",
        title: "Physics PS4",
        due: "2026-04-26T10:00:00.000Z",
        classColor: "blue",
        classTitle: "Physics 101",
      },
    ]);
  });

  it("handles unrelated assignments (no class join)", async () => {
    state.rows = [
      {
        id: "a2",
        title: "Free-floating todo",
        dueAt: new Date("2026-04-27T10:00:00Z"),
        classId: null,
        classTitle: null,
        classColor: null,
      },
    ];
    const out = await getDueSoonAssignments("u1");
    expect(out[0]).toMatchObject({
      classColor: null,
      classTitle: null,
    });
  });
});
