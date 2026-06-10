import { beforeEach, describe, expect, it, vi } from "vitest";

// The 30-day backfill must fire AT MOST ONCE per user. Idempotency is the
// users.email_backfill_completed_at marker: maybeTriggerEmailBackfill stamps
// it BEFORE publishing the QStash one-shot, and short-circuits when it's
// already set. These tests pin: (1) first connect → stamp + publish exactly
// once, (2) marker already set → no stamp, no publish, (3) gmail not
// connected → no-op.

const publishJSONMock = vi.fn();
vi.mock("@/lib/integrations/qstash/client", () => ({
  qstash: () => ({ publishJSON: publishJSONMock }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ APP_URL: "https://app.test" }),
}));

type FakeUser = { emailBackfillCompletedAt: Date | null } | null;
const fixture = { user: null as FakeUser };
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (fixture.user ? [fixture.user] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(values);
          return undefined;
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: {}, emailBackfillCompletedAt: {} },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

// runEmailBackfill is in the same module; it must NOT be invoked by the
// enqueue path (the whole point is to NOT run inline). It pulls ingestSince
// transitively, so mock that to a no-op to keep the import graph light.
vi.mock("@/lib/agent/email/ingest-recent", () => ({
  ingestSince: vi.fn(async () => ({
    scanned: 0,
    created: 0,
    skipped: 0,
    bucketCounts: {},
    durationMs: 0,
  })),
}));

beforeEach(() => {
  publishJSONMock.mockReset();
  publishJSONMock.mockResolvedValue({ messageId: "qstash-bf-1" });
  fixture.user = null;
  updateCalls.length = 0;
});

async function loadTrigger() {
  const mod = await import("@/lib/agent/email/backfill");
  return mod.maybeTriggerEmailBackfill;
}

describe("maybeTriggerEmailBackfill — idempotency", () => {
  it("first connect (marker null): stamps marker + publishes one-shot once", async () => {
    fixture.user = { emailBackfillCompletedAt: null };
    const trigger = await loadTrigger();

    await trigger({ userId: "user-1", gmailConnected: true });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].emailBackfillCompletedAt).toBeInstanceOf(Date);
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    expect(publishJSONMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.test/api/cron/email-backfill",
        body: { userId: "user-1" },
      })
    );
  });

  it("marker already set: no stamp, no publish (never re-runs)", async () => {
    fixture.user = { emailBackfillCompletedAt: new Date("2026-01-01") };
    const trigger = await loadTrigger();

    await trigger({ userId: "user-1", gmailConnected: true });

    expect(updateCalls).toHaveLength(0);
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  it("gmail not connected: no-op", async () => {
    fixture.user = { emailBackfillCompletedAt: null };
    const trigger = await loadTrigger();

    await trigger({ userId: "user-1", gmailConnected: false });

    expect(updateCalls).toHaveLength(0);
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  it("missing user row: no-op", async () => {
    fixture.user = null;
    const trigger = await loadTrigger();

    await trigger({ userId: "ghost", gmailConnected: true });

    expect(updateCalls).toHaveLength(0);
    expect(publishJSONMock).not.toHaveBeenCalled();
  });
});

describe("runEmailBackfill — delegates to ingestSince with the backfill window", () => {
  it("calls ingestSince with backfillMode + a 24h..30d window", async () => {
    const ingestMod = await import("@/lib/agent/email/ingest-recent");
    const ingestSince = ingestMod.ingestSince as ReturnType<typeof vi.fn>;
    ingestSince.mockClear();

    const { runEmailBackfill } = await import("@/lib/agent/email/backfill");
    await runEmailBackfill("user-1");

    expect(ingestSince).toHaveBeenCalledTimes(1);
    const [userId, opts] = ingestSince.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(opts.backfillMode).toBe(true);
    expect(opts.windowLabel).toBe("backfill_30d");
    // Lower bound ~30d back, upper bound ~24h back; before < ... and the
    // window is strictly bounded (before is defined).
    expect(typeof opts.sinceUnix).toBe("number");
    expect(typeof opts.beforeUnix).toBe("number");
    expect(opts.sinceUnix).toBeLessThan(opts.beforeUnix);
    const spanSeconds = opts.beforeUnix - opts.sinceUnix;
    // 30d - 24h = 29 days, in seconds.
    expect(spanSeconds).toBeGreaterThan(28 * 24 * 60 * 60);
    expect(spanSeconds).toBeLessThan(30 * 24 * 60 * 60);
  });
});
