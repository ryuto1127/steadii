import { beforeEach, describe, expect, it, vi } from "vitest";

// The ingest-sweep cron must:
// - reject when QStash signature verification fails
// - select all gmail-scoped users
// - call ingestLast24h once per user, surfacing per-user failures without
//   poisoning the rest of the tick

const verifyMock = vi.fn();
vi.mock("@/lib/integrations/qstash/verify", () => ({
  verifyQStashSignature: (req: Request, body: string) => verifyMock(req, body),
}));

type Row = { userId: string };
const userRows: Row[] = [];
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => userRows,
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  accounts: { userId: {}, provider: {}, scope: {} },
  users: { id: {}, deletedAt: {} },
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  like: () => ({}),
}));

const ingestMock = vi.fn();
vi.mock("@/lib/agent/email/ingest-recent", () => ({
  ingestLast24h: (id: string) => ingestMock(id),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  verifyMock.mockReset();
  ingestMock.mockReset();
  userRows.length = 0;
});

function makeReq(): Request {
  return new Request("https://example.com/api/cron/ingest-sweep", {
    method: "POST",
    body: "",
  });
}

async function loadRoute() {
  const mod = await import("@/app/api/cron/ingest-sweep/route");
  return mod.POST;
}

describe("/api/cron/ingest-sweep", () => {
  it("returns 401 when signature verification fails", async () => {
    verifyMock.mockResolvedValue(false);
    const POST = await loadRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("calls ingestLast24h for each gmail-scoped user", async () => {
    verifyMock.mockResolvedValue(true);
    userRows.push({ userId: "u1" }, { userId: "u2" }, { userId: "u3" });
    ingestMock.mockResolvedValue({ scanned: 0, created: 0, skipped: 0, bucketCounts: {}, durationMs: 1 });
    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ users: 3, succeeded: 3, failed: 0 });
  });

  it("isolates per-user failures — one user erroring doesn't block the rest", async () => {
    verifyMock.mockResolvedValue(true);
    userRows.push({ userId: "u1" }, { userId: "u2" }, { userId: "u3" });
    ingestMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("gmail down"))
      .mockResolvedValueOnce({});
    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ users: 3, succeeded: 2, failed: 1 });
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0].userId).toBe("u2");
  });

  it("returns 200 with zero counts when no gmail-scoped users exist", async () => {
    verifyMock.mockResolvedValue(true);
    const POST = await loadRoute();
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ users: 0, succeeded: 0, failed: 0 });
    expect(ingestMock).not.toHaveBeenCalled();
  });
});
