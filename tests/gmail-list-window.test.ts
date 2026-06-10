import { beforeEach, describe, expect, it, vi } from "vitest";

// Window plumbing for listRecentMessages. The recurring 24h sweep passes
// only `since` (open-ended). The one-time 30-day backfill additionally
// passes `before` so its window is strictly bounded (24h..30d) and never
// overlaps the sweep's last-24h slice. These tests pin the exact Gmail `q`
// string the two callers produce.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_o: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

const listMock = vi.fn();
vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: async () => ({
    users: { messages: { list: listMock } },
  }),
}));

vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: () => ({ text: "", format: "text/plain" as const }),
}));

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: { messages: [], nextPageToken: null } });
});

async function load() {
  const mod = await import("@/lib/integrations/google/gmail-fetch");
  return mod.listRecentMessages;
}

describe("listRecentMessages — window query", () => {
  it("sweep path (no before) emits an open-ended after: query", async () => {
    const listRecentMessages = await load();
    await listRecentMessages("user-1", 1000);
    expect(listMock).toHaveBeenCalledTimes(1);
    const q = listMock.mock.calls[0][0].q as string;
    expect(q).toBe("after:1000");
    expect(q).not.toContain("before:");
  });

  it("backfill path (with before) emits a bounded after:..before: query", async () => {
    const listRecentMessages = await load();
    await listRecentMessages("user-1", 1000, 500, 2000);
    const q = listMock.mock.calls[0][0].q as string;
    expect(q).toBe("after:1000 before:2000");
  });

  it("honors the hardLimit page-size argument independently of the window", async () => {
    const listRecentMessages = await load();
    await listRecentMessages("user-1", 1000, 50, 2000);
    expect(listMock.mock.calls[0][0].maxResults).toBe(50);
  });
});
