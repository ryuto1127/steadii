import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  classes: {},
  events: {},
  groupProjects: {},
  inboxItems: {},
}));
vi.mock("drizzle-orm", () => {
  const id = (..._args: unknown[]) => ({});
  return {
    and: id,
    eq: id,
    gte: id,
    inArray: id,
    isNull: id,
    sql: Object.assign(
      (strings: TemplateStringsArray) => strings.join(""),
      { raw: () => ({}) }
    ),
  };
});

// We test the per-thread aggregation rule by reproducing the same
// logic the detect module runs. Doing it inline keeps the test data-
// driven and lets us assert the boundary cases cleanly without exposing
// the private helpers from detect.ts.

const MIN_THREAD_MESSAGES = 3;
const MIN_THREAD_PARTICIPANTS = 3;
const MIN_THREAD_ACTIVE_DAYS = 7;

type Row = {
  threadId: string;
  senderEmail: string;
  receivedAt: Date;
  recipientTo: string[];
  recipientCc: string[];
};

function aggregate(rows: Row[]) {
  type Agg = {
    messageCount: number;
    participants: Set<string>;
    firstAt: Date;
    lastAt: Date;
  };
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const ex = map.get(r.threadId);
    const all = [r.senderEmail, ...r.recipientTo, ...r.recipientCc];
    if (!ex) {
      map.set(r.threadId, {
        messageCount: 1,
        participants: new Set(all),
        firstAt: r.receivedAt,
        lastAt: r.receivedAt,
      });
    } else {
      ex.messageCount += 1;
      for (const e of all) ex.participants.add(e);
      if (r.receivedAt < ex.firstAt) ex.firstAt = r.receivedAt;
      if (r.receivedAt > ex.lastAt) ex.lastAt = r.receivedAt;
    }
  }
  return [...map.entries()].map(([id, a]) => ({
    threadId: id,
    messageCount: a.messageCount,
    participantCount: a.participants.size,
    daysActive:
      (a.lastAt.getTime() - a.firstAt.getTime()) / (24 * 60 * 60 * 1000),
  }));
}

function fires(t: ReturnType<typeof aggregate>[number]) {
  return (
    t.messageCount >= MIN_THREAD_MESSAGES &&
    t.participantCount >= MIN_THREAD_PARTICIPANTS &&
    t.daysActive >= MIN_THREAD_ACTIVE_DAYS
  );
}

describe("group-project email-thread detection rule", () => {
  it("fires when 3+ messages × 3+ people × 7+ days are present", () => {
    const rows: Row[] = [
      {
        threadId: "t1",
        senderEmail: "jane@u.ac.jp",
        recipientTo: ["me@u.ac.jp", "bob@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-01"),
      },
      {
        threadId: "t1",
        senderEmail: "bob@u.ac.jp",
        recipientTo: ["me@u.ac.jp", "jane@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-05"),
      },
      {
        threadId: "t1",
        senderEmail: "carlos@u.ac.jp",
        recipientTo: ["me@u.ac.jp"],
        recipientCc: ["jane@u.ac.jp", "bob@u.ac.jp"],
        receivedAt: new Date("2026-04-10"),
      },
    ];
    const aggs = aggregate(rows);
    expect(aggs).toHaveLength(1);
    expect(fires(aggs[0]!)).toBe(true);
  });

  it("does NOT fire when participants are < 3", () => {
    const rows: Row[] = [
      {
        threadId: "t2",
        senderEmail: "jane@u.ac.jp",
        recipientTo: ["me@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-01"),
      },
      {
        threadId: "t2",
        senderEmail: "jane@u.ac.jp",
        recipientTo: ["me@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-15"),
      },
      {
        threadId: "t2",
        senderEmail: "me@u.ac.jp",
        recipientTo: ["jane@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-20"),
      },
    ];
    const aggs = aggregate(rows);
    expect(aggs[0]!.participantCount).toBe(2);
    expect(fires(aggs[0]!)).toBe(false);
  });

  it("does NOT fire when active window is < 7 days", () => {
    const rows: Row[] = [
      {
        threadId: "t3",
        senderEmail: "a@u.ac.jp",
        recipientTo: ["b@u.ac.jp", "c@u.ac.jp", "d@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-01"),
      },
      {
        threadId: "t3",
        senderEmail: "b@u.ac.jp",
        recipientTo: ["a@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-02"),
      },
      {
        threadId: "t3",
        senderEmail: "c@u.ac.jp",
        recipientTo: ["a@u.ac.jp"],
        recipientCc: [],
        receivedAt: new Date("2026-04-03"),
      },
    ];
    const aggs = aggregate(rows);
    expect(fires(aggs[0]!)).toBe(false);
  });
});
