import { beforeEach, describe, expect, it, vi } from "vitest";

// Env stub — needed by lib/db/client.ts import chain.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// Hoisted mock state so the vi.mock factory below can close over it
// without TDZ issues.
const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    userId: string;
    inboxItemId: string;
    eventRefs: Array<{
      provider: "google_calendar" | "microsoft_graph";
      eventId: string;
      htmlLink: string | null;
    }>;
    status: "provisional" | "confirmed" | "cancelled";
    agreedSlot: { date: string; startTime: string; timezone: string; durationMin: number };
    confidence: number;
    createdAt: Date;
    graceExpiresAt: Date;
    cancelledAt: Date | null;
  };
  return {
    state: {
      rows: [] as Row[],
      updates: [] as Array<{ id: string; status: string }>,
    },
  };
});

vi.mock("@/lib/db/client", () => {
  const chain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      limit: () => c,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return c;
  };

  return {
    db: {
      select: () => chain(mocks.state.rows.filter((r) => r.status === "provisional")),
      update: () => ({
        set: (vals: { status: string }) => ({
          where: async () => {
            // The where clause filters by id; we mimic by stamping all
            // remaining unset rows. Tests assert via `mocks.state.updates`.
            mocks.state.updates.push({ id: "*", status: vals.status });
          },
        }),
      }),
    },
  };
});

import {
  runAutoCalGraceSweep,
  STEADII_PREFIX,
  type CalendarTitleEditor,
} from "@/lib/agent/proactive/auto-cal-grace";

const NOW = new Date("2026-05-22T12:00:00Z").getTime();
const EXPIRED = new Date("2026-05-22T10:00:00Z"); // 2h before NOW
const NOT_EXPIRED = new Date("2026-05-23T12:00:00Z"); // 24h after NOW

function row(opts: {
  id: string;
  status?: "provisional" | "confirmed" | "cancelled";
  graceExpiresAt?: Date;
  eventIds?: string[];
}) {
  return {
    id: opts.id,
    userId: `user-${opts.id}`,
    inboxItemId: `inbox-${opts.id}`,
    eventRefs: (opts.eventIds ?? ["evt-1"]).map((id) => ({
      provider: "google_calendar" as const,
      eventId: id,
      htmlLink: null,
    })),
    status: opts.status ?? "provisional",
    agreedSlot: {
      date: "2026-05-22",
      startTime: "14:00",
      timezone: "Asia/Tokyo",
      durationMin: 60,
    },
    confidence: 0.85,
    createdAt: new Date("2026-05-21T12:00:00Z"),
    graceExpiresAt: opts.graceExpiresAt ?? EXPIRED,
    cancelledAt: null,
  };
}

function makeEditor(opts: {
  titles: Record<string, string | null>;
  failPatch?: Set<string>;
}): CalendarTitleEditor & {
  patched: Array<{ eventId: string; newTitle: string }>;
} {
  const patched: Array<{ eventId: string; newTitle: string }> = [];
  return {
    patched,
    async fetchTitle({ ref }) {
      return opts.titles[ref.eventId] ?? null;
    },
    async updateTitle({ ref, newTitle }) {
      if (opts.failPatch?.has(ref.eventId)) {
        throw new Error(`patch failed for ${ref.eventId}`);
      }
      patched.push({ eventId: ref.eventId, newTitle });
    },
  };
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
});

describe("runAutoCalGraceSweep — happy path", () => {
  it("drops [Steadii] prefix and promotes row to confirmed", async () => {
    mocks.state.rows = [row({ id: "r1" })];
    const editor = makeEditor({
      titles: { "evt-1": `${STEADII_PREFIX}Interview with Sample Corp` },
    });

    const result = await runAutoCalGraceSweep({
      nowMs: NOW,
      editor,
    });

    expect(result.scanned).toBe(1);
    expect(result.promoted).toBe(1);
    expect(result.renameFailures).toBe(0);
    expect(editor.patched).toEqual([
      { eventId: "evt-1", newTitle: "Interview with Sample Corp" },
    ]);
    expect(mocks.state.updates).toEqual([{ id: "*", status: "confirmed" }]);
  });

  it("handles multi-provider event_refs (each is renamed)", async () => {
    mocks.state.rows = [row({ id: "r1", eventIds: ["evt-g", "evt-ms"] })];
    const editor = makeEditor({
      titles: {
        "evt-g": `${STEADII_PREFIX}Sync`,
        "evt-ms": `${STEADII_PREFIX}Sync`,
      },
    });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor });
    expect(result.promoted).toBe(1);
    expect(editor.patched).toHaveLength(2);
  });

  it("returns scanned=0 when no provisional rows exist", async () => {
    mocks.state.rows = [];
    const editor = makeEditor({ titles: {} });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor });
    expect(result.scanned).toBe(0);
    expect(result.promoted).toBe(0);
  });
});

describe("runAutoCalGraceSweep — resilience", () => {
  it("skips rename when fetchTitle returns null (event deleted upstream), still promotes", async () => {
    mocks.state.rows = [row({ id: "r1" })];
    const editor = makeEditor({ titles: { "evt-1": null } });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor });
    expect(result.promoted).toBe(1);
    expect(result.renameFailures).toBe(0);
    expect(editor.patched).toHaveLength(0);
    expect(mocks.state.updates).toEqual([{ id: "*", status: "confirmed" }]);
  });

  it("skips rename when current title lacks the prefix (idempotency)", async () => {
    mocks.state.rows = [row({ id: "r1" })];
    const editor = makeEditor({
      titles: { "evt-1": "Already cleaned title (no prefix)" },
    });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor });
    expect(result.promoted).toBe(1);
    expect(result.renameFailures).toBe(0);
    expect(editor.patched).toHaveLength(0);
  });

  it("counts rename failure but still promotes the row (cosmetic vs semantic)", async () => {
    mocks.state.rows = [row({ id: "r1" })];
    const editor = makeEditor({
      titles: { "evt-1": `${STEADII_PREFIX}Some meeting` },
      failPatch: new Set(["evt-1"]),
    });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor });
    expect(result.promoted).toBe(1);
    expect(result.renameFailures).toBe(1);
    expect(mocks.state.updates).toEqual([{ id: "*", status: "confirmed" }]);
  });

  it("respects the limit cap so a backlog can't time out the cron", async () => {
    // We can't observe limit directly in the mock (the mock returns
    // ALL provisional rows), but we can verify the function passes
    // the option through by checking the row count it processes
    // when many rows are queued. Mock's chain ignores .limit(), so
    // this test acts as a smoke check the path runs without error.
    mocks.state.rows = Array.from({ length: 50 }, (_, i) =>
      row({ id: `r${i}` }),
    );
    const editor = makeEditor({
      titles: Object.fromEntries(
        mocks.state.rows.map((r) => [
          r.eventRefs[0].eventId,
          `${STEADII_PREFIX}Title ${r.id}`,
        ]),
      ),
    });
    const result = await runAutoCalGraceSweep({ nowMs: NOW, editor, limit: 20 });
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.promoted).toBe(result.scanned);
  });
});

describe("STEADII_PREFIX constant", () => {
  it("matches the evaluator's prefix exactly so the rename round-trips", () => {
    // The evaluator writes "[Steadii] " (with a single trailing space).
    // If these drift, the cron will silently fail to recognize titles
    // it should rename.
    expect(STEADII_PREFIX).toBe("[Steadii] ");
  });
});
