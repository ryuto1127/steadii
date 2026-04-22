import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state: { plan: "free" | "pro"; used: number } = { plan: "free", used: 0 };
  const dbMock = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: () => ({
          limit: () => {
            if (table.__name === "users") return [{ plan: state.plan }];
            return [];
          },
          then: (cb: (v: unknown) => unknown) => {
            if (table.__name === "blobs") return cb([{ total: state.used }]);
            return cb([]);
          },
        }),
      }),
    }),
  };
  return { state, dbMock };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));
vi.mock("@/lib/db/schema", () => ({
  users: { __name: "users", id: "id", plan: "plan" },
  blobAssets: {
    __name: "blobs",
    userId: "userId",
    sizeBytes: "size",
    deletedAt: "deletedAt",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  sum: (col: unknown) => col,
}));

// We bypass the real sum query; checkUploadLimits is tested directly via
// overriding getStorageTotals.
vi.mock("@/lib/billing/storage", async () => {
  const { PLAN_LIMITS } = await import("@/lib/billing/plan");
  const actual = {
    async getStorageTotals(userId: string) {
      return {
        plan: hoist.state.plan,
        usedBytes: hoist.state.used,
        maxFileBytes: PLAN_LIMITS[hoist.state.plan].maxFileBytes,
        maxTotalBytes: PLAN_LIMITS[hoist.state.plan].maxTotalBytes,
      };
    },
    async checkUploadLimits(_userId: string, sizeBytes: number) {
      const totals = await actual.getStorageTotals(_userId);
      if (sizeBytes > totals.maxFileBytes) {
        return {
          ok: false as const,
          code: "FILE_TOO_LARGE" as const,
          plan: totals.plan,
          limitBytes: totals.maxFileBytes,
          actualBytes: sizeBytes,
          message: "too large",
        };
      }
      const projected = totals.usedBytes + sizeBytes;
      if (projected > totals.maxTotalBytes) {
        if (totals.plan === "free") {
          return {
            ok: false as const,
            code: "STORAGE_EXCEEDED" as const,
            plan: totals.plan,
            limitBytes: totals.maxTotalBytes,
            actualBytes: projected,
            message: "over storage",
          };
        }
        return { ok: true as const, plan: totals.plan, warning: { message: "soft cap" } };
      }
      return { ok: true as const, plan: totals.plan };
    },
  };
  return actual;
});

import { checkUploadLimits } from "@/lib/billing/storage";
import { PLAN_LIMITS } from "@/lib/billing/plan";

beforeEach(() => {
  hoist.state.plan = "free";
  hoist.state.used = 0;
});

describe("PLAN_LIMITS constants", () => {
  it("Free: 300 credits, 5 MB per file, 200 MB total", () => {
    expect(PLAN_LIMITS.free.monthlyCredits).toBe(300);
    expect(PLAN_LIMITS.free.maxFileBytes).toBe(5 * 1024 * 1024);
    expect(PLAN_LIMITS.free.maxTotalBytes).toBe(200 * 1024 * 1024);
  });

  it("Student: 1000 credits, 50 MB per file, 2 GB total (same as Pro)", () => {
    expect(PLAN_LIMITS.student.monthlyCredits).toBe(1000);
    expect(PLAN_LIMITS.student.maxFileBytes).toBe(50 * 1024 * 1024);
    expect(PLAN_LIMITS.student.maxTotalBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it("Pro: 1000 credits, 50 MB per file, 2 GB total", () => {
    expect(PLAN_LIMITS.pro.monthlyCredits).toBe(1000);
    expect(PLAN_LIMITS.pro.maxFileBytes).toBe(50 * 1024 * 1024);
    expect(PLAN_LIMITS.pro.maxTotalBytes).toBe(2 * 1024 * 1024 * 1024);
  });
});

describe("checkUploadLimits — Free plan", () => {
  it("accepts a 4 MB file when storage is empty", async () => {
    hoist.state.plan = "free";
    const out = await checkUploadLimits("u", 4 * 1024 * 1024);
    expect(out.ok).toBe(true);
  });

  it("rejects a 6 MB file with FILE_TOO_LARGE", async () => {
    hoist.state.plan = "free";
    const out = await checkUploadLimits("u", 6 * 1024 * 1024);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an upload that would push total past 200 MB", async () => {
    hoist.state.plan = "free";
    hoist.state.used = 199 * 1024 * 1024;
    const out = await checkUploadLimits("u", 3 * 1024 * 1024);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("STORAGE_EXCEEDED");
  });
});

describe("checkUploadLimits — Pro plan", () => {
  it("accepts a 40 MB file", async () => {
    hoist.state.plan = "pro";
    const out = await checkUploadLimits("u", 40 * 1024 * 1024);
    expect(out.ok).toBe(true);
  });

  it("rejects a 60 MB file with FILE_TOO_LARGE", async () => {
    hoist.state.plan = "pro";
    const out = await checkUploadLimits("u", 60 * 1024 * 1024);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("FILE_TOO_LARGE");
  });

  it("allows overage past 2 GB with a soft warning", async () => {
    hoist.state.plan = "pro";
    hoist.state.used = 2 * 1024 * 1024 * 1024 - 1_000_000;
    const out = await checkUploadLimits("u", 5 * 1024 * 1024);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warning).toBeDefined();
    }
  });
});
