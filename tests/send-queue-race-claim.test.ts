import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the polish-13b race-condition fix in the send-queue cron.
// Overlapping cron ticks (tick N still draining when tick N+1 fires)
// could previously cause double-sends — both ticks SELECT the same
// pending rows, both call Gmail API, both UPDATE to 'sent'. The fix
// uses UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) so
// each row is exclusively held by one tick.
//
// These tests prove the orchestration calls the right paths in the
// right order:
//   - QStash signature failure short-circuits with 401.
//   - When the atomic claim returns null, the loop exits without
//     calling sendAndAudit.
//   - When the claim returns a row, sendAndAudit fires once and the
//     row transitions to 'sent'.
//   - Multiple successive claims drain to empty without double-sends.
//   - Stale-claim sweep runs before any claim attempt.

const verifyMock = vi.fn();
vi.mock("@/lib/integrations/qstash/verify", () => ({
  verifyQStashSignature: (req: Request, body: string) =>
    verifyMock(req, body),
}));

type FakeRow = {
  id: string;
  userId: string;
  agentDraftId: string;
  gmailDraftId: string;
  attemptCount: number;
};

const fixture = {
  claimQueue: [] as FakeRow[],
  staleSwept: 0,
  draftRowResult: [] as Array<{
    action: string;
    autoSent: boolean;
    inboxItemId: string;
    senderEmail: string;
    senderDomain: string;
  }>,
};
const dbCalls: string[] = [];
let lastClaimedRow: FakeRow | null = null;

vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn(async (sqlObj: unknown) => {
      // Drizzle's sql tag is mocked to return only the joined static
      // parts. We disambiguate the two raw queries by the unique
      // `FOR UPDATE` substring (claim) vs everything else (sweep).
      const repr = String(sqlObj ?? "");
      if (repr.includes("FOR UPDATE")) {
        dbCalls.push("execute.claim");
        const next = fixture.claimQueue.shift();
        if (!next) {
          lastClaimedRow = null;
          return { rows: [] };
        }
        lastClaimedRow = next;
        return { rows: [{ id: next.id }] };
      }
      dbCalls.push("execute.sweep");
      return { rowCount: fixture.staleSwept };
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            // Post-claim full-row read.
            dbCalls.push("select.row");
            return lastClaimedRow ? [{ ...lastClaimedRow }] : [];
          },
        }),
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              // Draft + inboxItem join for sender feedback.
              dbCalls.push("select.draft");
              return fixture.draftRowResult;
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          dbCalls.push("update");
          return undefined;
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sendQueue: { id: {}, userId: {}, status: {} },
  agentDrafts: { id: {}, action: {}, autoSent: {}, inboxItemId: {} },
  inboxItems: { id: {}, senderEmail: {}, senderDomain: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      strings.join(""),
    { raw: () => ({}) }
  ),
}));

const sendAndAuditMock = vi.fn();
vi.mock("@/lib/agent/tools/gmail", () => ({
  sendAndAudit: (...args: unknown[]) => sendAndAuditMock(...args),
}));

const recordSenderFeedbackMock = vi.fn();
vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: (...args: unknown[]) =>
    recordSenderFeedbackMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  verifyMock.mockReset();
  verifyMock.mockResolvedValue(true);
  sendAndAuditMock.mockReset();
  recordSenderFeedbackMock.mockReset();
  fixture.claimQueue = [];
  fixture.staleSwept = 0;
  fixture.draftRowResult = [];
  dbCalls.length = 0;
  lastClaimedRow = null;
});

function makeReq(): Request {
  return new Request("https://example.com/api/cron/send-queue", {
    method: "POST",
    body: "",
  });
}

async function loadRoute() {
  const mod = await import("@/app/api/cron/send-queue/route");
  return mod.POST;
}

function fakeRow(id: string, attemptCount = 0): FakeRow {
  return {
    id,
    userId: `user-${id}`,
    agentDraftId: `draft-${id}`,
    gmailDraftId: `gd-${id}`,
    attemptCount,
  };
}

describe("/api/cron/send-queue — atomic claim", () => {
  it("returns 401 when QStash signature verification fails", async () => {
    verifyMock.mockResolvedValue(false);
    const POST = await loadRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(sendAndAuditMock).not.toHaveBeenCalled();
  });

  it("exits without sending when the atomic claim returns no row", async () => {
    fixture.claimQueue = [];
    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(sendAndAuditMock).not.toHaveBeenCalled();
    // Sweep still ran even though there was nothing to drain.
    expect(dbCalls.filter((c) => c === "execute.sweep")).toHaveLength(1);
  });

  it("calls sendAndAudit exactly once per claimed row", async () => {
    fixture.claimQueue = [fakeRow("r1")];
    fixture.draftRowResult = [
      {
        action: "send_reply",
        autoSent: false,
        inboxItemId: "ix-1",
        senderEmail: "prof@uni.edu",
        senderDomain: "uni.edu",
      },
    ];
    sendAndAuditMock.mockResolvedValue({ gmailMessageId: "msg-1" });

    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(sendAndAuditMock).toHaveBeenCalledTimes(1);
    expect(sendAndAuditMock).toHaveBeenCalledWith(
      "user-r1",
      "gd-r1",
      "draft-r1"
    );
    expect(recordSenderFeedbackMock).toHaveBeenCalledTimes(1);
  });

  it("drains successive claims — two rows produce two sends, no double-send", async () => {
    fixture.claimQueue = [fakeRow("r1"), fakeRow("r2")];
    fixture.draftRowResult = [
      {
        action: "send_reply",
        autoSent: false,
        inboxItemId: "ix",
        senderEmail: "p@u.edu",
        senderDomain: "u.edu",
      },
    ];
    let counter = 0;
    sendAndAuditMock.mockImplementation(async () => ({
      gmailMessageId: `msg-${counter++}`,
    }));

    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: 2, sent: 2, failed: 0 });
    // Each row is sent exactly once. The atomic claim guarantees no
    // second cron tick could have grabbed the same row.
    expect(sendAndAuditMock).toHaveBeenCalledTimes(2);
  });

  it("counts failures when sendAndAudit throws", async () => {
    fixture.claimQueue = [fakeRow("r1", 2)];
    fixture.draftRowResult = [];
    sendAndAuditMock.mockRejectedValue(new Error("gmail down"));

    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect(sendAndAuditMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/cron/send-queue — stale sweep", () => {
  it("invokes the stale-claim sweep before any claim attempt", async () => {
    fixture.claimQueue = [];
    fixture.staleSwept = 3;

    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.recovered).toBe(3);
    const sweepIdx = dbCalls.indexOf("execute.sweep");
    const firstClaimIdx = dbCalls.indexOf("execute.claim");
    expect(sweepIdx).toBeGreaterThanOrEqual(0);
    // Sweep precedes claim — recovers stuck rows so they're eligible
    // for re-claim within the same tick.
    expect(sweepIdx).toBeLessThan(firstClaimIdx);
  });
});
