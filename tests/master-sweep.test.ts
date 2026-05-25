import { beforeEach, describe, expect, it, vi } from "vitest";

// The master-sweep dispatcher must:
//   - At minute=0 (hourly): run ALL sub-sweeps (always + 30-min + hourly)
//   - At minute=15: run only the always sub-sweeps (pre-brief, ingest)
//   - At minute=30: run always + 30-min sub-sweeps, skip hourly
//   - At minute=45: run only the always sub-sweeps
//   - Isolate per-sub-sweep failures so one throwing doesn't poison
//     the others — each failure lands in summary.errors[name]
//
// The sub-sweeps are injected as a typed `SubSweeps` record so this
// test never touches Gmail, the DB, or any real I/O. The vi.mock
// stubs below are belt-and-suspenders for the Sentry import chain.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

import {
  dispatchMasterSweep,
  type SubSweepName,
  type SubSweeps,
} from "@/lib/cron/master-sweep";

const ALL_SUB_SWEEPS: SubSweepName[] = [
  "pre-brief",
  "ingest-sweep",
  "auto-cal-proposal-expiry",
  "draft-superseded",
  "disposition-resurface",
  "digest",
  "weekly-digest",
];

const ALWAYS: SubSweepName[] = ["pre-brief", "ingest-sweep"];
const THIRTY_MIN: SubSweepName[] = [
  "auto-cal-proposal-expiry",
  "draft-superseded",
  "disposition-resurface",
];
const HOURLY: SubSweepName[] = ["digest", "weekly-digest"];

function makeSubs(): SubSweeps {
  return {
    "pre-brief": vi.fn().mockResolvedValue({ ok: true, kind: "pre-brief" }),
    "ingest-sweep": vi
      .fn()
      .mockResolvedValue({ ok: true, kind: "ingest-sweep" }),
    "auto-cal-proposal-expiry": vi
      .fn()
      .mockResolvedValue({ ok: true, kind: "auto-cal-proposal-expiry" }),
    // legacy values omitted — the type was narrowed in PR Round-3.
    "draft-superseded": vi
      .fn()
      .mockResolvedValue({ ok: true, kind: "draft-superseded" }),
    "disposition-resurface": vi
      .fn()
      .mockResolvedValue({ ok: true, kind: "disposition-resurface" }),
    digest: vi.fn().mockResolvedValue({ ok: true, kind: "digest" }),
    "weekly-digest": vi
      .fn()
      .mockResolvedValue({ ok: true, kind: "weekly-digest" }),
  };
}

function atMinute(min: number): number {
  // 2026-05-22 12:MM:00 UTC — a fixed base time well clear of DST
  // edges so getUTCMinutes() reads back exactly `min`.
  return Date.UTC(2026, 4, 22, 12, min, 0);
}

function callsCalled(subs: SubSweeps): SubSweepName[] {
  return ALL_SUB_SWEEPS.filter(
    (name) => (subs[name] as ReturnType<typeof vi.fn>).mock.calls.length > 0
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchMasterSweep — modulo dispatch", () => {
  it("at minute=0, runs ALL sub-sweeps (always + 30-min + hourly)", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({ nowMs: atMinute(0), subSweeps: subs });

    expect(r.ran).toEqual([
      ...ALWAYS,
      ...THIRTY_MIN,
      ...HOURLY,
    ]);
    expect(r.skipped).toEqual([]);
    expect(callsCalled(subs)).toEqual(ALL_SUB_SWEEPS);
    expect(r.errors).toEqual({});
  });

  it("at minute=15, runs only the always sub-sweeps", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({ nowMs: atMinute(15), subSweeps: subs });

    expect(r.ran).toEqual(ALWAYS);
    expect(r.skipped).toEqual([...THIRTY_MIN, ...HOURLY]);
    expect(callsCalled(subs)).toEqual(ALWAYS);
    expect(subs["auto-cal-proposal-expiry"]).not.toHaveBeenCalled();
    expect(subs.digest).not.toHaveBeenCalled();
  });

  it("at minute=30, runs always + 30-min sub-sweeps but skips hourly", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({ nowMs: atMinute(30), subSweeps: subs });

    expect(r.ran).toEqual([...ALWAYS, ...THIRTY_MIN]);
    expect(r.skipped).toEqual(HOURLY);
    expect(subs["auto-cal-proposal-expiry"]).toHaveBeenCalledTimes(1);
    expect(subs.digest).not.toHaveBeenCalled();
    expect(subs["weekly-digest"]).not.toHaveBeenCalled();
  });

  it("at minute=45, runs only the always sub-sweeps", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({ nowMs: atMinute(45), subSweeps: subs });

    expect(r.ran).toEqual(ALWAYS);
    expect(r.skipped).toEqual([...THIRTY_MIN, ...HOURLY]);
  });

  it("reports the minute used for dispatch in the summary", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({ nowMs: atMinute(30), subSweeps: subs });
    expect(r.minute).toBe(30);
    expect(r.tickAt).toBe(new Date(atMinute(30)).toISOString());
  });
});

describe("dispatchMasterSweep — failure isolation", () => {
  it("a single sub-sweep throwing doesn't block the others; error appears in summary", async () => {
    const subs = makeSubs();
    (subs["pre-brief"] as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("pre-brief boom")
    );

    const r = await dispatchMasterSweep({
      nowMs: atMinute(0),
      subSweeps: subs,
    });

    // pre-brief is recorded as an error, not in `ran`.
    expect(r.ran).not.toContain("pre-brief");
    expect(r.errors).toEqual({ "pre-brief": "pre-brief boom" });

    // Every other sub-sweep at minute=0 still ran.
    for (const name of ALL_SUB_SWEEPS.filter((n) => n !== "pre-brief")) {
      expect(r.ran).toContain(name);
      expect(subs[name]).toHaveBeenCalledTimes(1);
    }
  });

  it("multiple sub-sweeps can fail in the same tick and each error is recorded", async () => {
    const subs = makeSubs();
    (subs["ingest-sweep"] as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ingest down")
    );
    (subs.digest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("resend 500")
    );

    const r = await dispatchMasterSweep({
      nowMs: atMinute(0),
      subSweeps: subs,
    });

    expect(r.errors).toEqual({
      "ingest-sweep": "ingest down",
      digest: "resend 500",
    });
    // Non-failing sub-sweeps at minute=0 still ran.
    expect(r.ran).toContain("pre-brief");
    expect(r.ran).toContain("auto-cal-proposal-expiry");
    expect(r.ran).toContain("draft-superseded");
    expect(r.ran).toContain("disposition-resurface");
    expect(r.ran).toContain("weekly-digest");
  });

  it("non-Error throwables are stringified into the errors map", async () => {
    const subs = makeSubs();
    (subs["pre-brief"] as ReturnType<typeof vi.fn>).mockRejectedValue(
      "string-err"
    );

    const r = await dispatchMasterSweep({
      nowMs: atMinute(15),
      subSweeps: subs,
    });

    expect(r.errors["pre-brief"]).toBe("string-err");
  });

  it("sub-sweep failures at a skip-tick still don't run (skipped beats error)", async () => {
    const subs = makeSubs();
    // At minute=15, the digest sub-sweep is skipped — so even if it
    // WOULD throw, the dispatcher must never call it.
    (subs.digest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("should never fire")
    );

    const r = await dispatchMasterSweep({
      nowMs: atMinute(15),
      subSweeps: subs,
    });

    expect(subs.digest).not.toHaveBeenCalled();
    expect(r.errors).toEqual({});
  });
});

describe("dispatchMasterSweep — result capture", () => {
  it("captures each sub-sweep's return value in summary.results keyed by name", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({
      nowMs: atMinute(0),
      subSweeps: subs,
    });

    expect(r.results["pre-brief"]).toEqual({ ok: true, kind: "pre-brief" });
    expect(r.results["ingest-sweep"]).toEqual({
      ok: true,
      kind: "ingest-sweep",
    });
    expect(r.results["auto-cal-proposal-expiry"]).toEqual({
      ok: true,
      kind: "auto-cal-proposal-expiry",
    });
    expect(r.results["draft-superseded"]).toEqual({
      ok: true,
      kind: "draft-superseded",
    });
    expect(r.results["disposition-resurface"]).toEqual({
      ok: true,
      kind: "disposition-resurface",
    });
    expect(r.results.digest).toEqual({ ok: true, kind: "digest" });
    expect(r.results["weekly-digest"]).toEqual({
      ok: true,
      kind: "weekly-digest",
    });
  });

  it("does not include results for skipped sub-sweeps", async () => {
    const subs = makeSubs();
    const r = await dispatchMasterSweep({
      nowMs: atMinute(15),
      subSweeps: subs,
    });

    expect(r.results["pre-brief"]).toBeDefined();
    expect(r.results["ingest-sweep"]).toBeDefined();
    expect(r.results.digest).toBeUndefined();
    expect(r.results["weekly-digest"]).toBeUndefined();
    expect(r.results["auto-cal-proposal-expiry"]).toBeUndefined();
    expect(r.results["draft-superseded"]).toBeUndefined();
    expect(r.results["disposition-resurface"]).toBeUndefined();
  });
});
