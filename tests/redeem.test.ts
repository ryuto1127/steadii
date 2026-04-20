import { describe, expect, it, beforeEach, vi } from "vitest";

type CodeRow = {
  id: string;
  code: string;
  type: "admin" | "friend";
  durationDays: number;
  maxUses: number;
  usesCount: number;
  note: string | null;
  expiresAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
};

type RedemptionRow = {
  id: string;
  userId: string;
  codeId: string;
  redeemedAt: Date;
  effectiveUntil: Date;
};

const hoist = vi.hoisted(() => {
  const state = {
    codes: [] as CodeRow[],
    redemptions: [] as RedemptionRow[],
    audit: [] as Array<Record<string, unknown>>,
    idSeq: 0,
  };

  function matches(row: Record<string, unknown>, filter: unknown): boolean {
    if (!filter) return true;
    const f = filter as { __op: string; [k: string]: unknown };
    if (f.__op === "eq") return row[f.col as string] === f.val;
    if (f.__op === "gt")
      return (row[f.col as string] as Date) > (f.val as Date);
    if (f.__op === "and")
      return (f.children as unknown[]).every((c) => matches(row, c));
    return true;
  }

  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: (filter: unknown) => {
          const source =
            table.__name === "codes"
              ? state.codes
              : table.__name === "redemptions"
              ? state.redemptions
              : [];
          const rows = source.filter((r) =>
            matches(r as unknown as Record<string, unknown>, filter)
          );
          return {
            limit: () => rows,
            innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }),
          };
        },
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: async (v: unknown) => {
        const arr = Array.isArray(v) ? v : [v];
        if (table.__name === "redemptions") {
          for (const item of arr as Record<string, unknown>[]) {
            state.idSeq += 1;
            state.redemptions.push({
              id: `r-${state.idSeq}`,
              redeemedAt: new Date(),
              ...item,
            } as RedemptionRow);
          }
        } else if (table.__name === "audit") {
          state.audit.push(...(arr as Record<string, unknown>[]));
        }
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (filter: unknown) => {
          const source =
            table.__name === "codes" ? state.codes : table.__name === "users" ? [] : state.redemptions;
          for (const r of source) {
            if (matches(r as unknown as Record<string, unknown>, filter))
              Object.assign(r, patch);
          }
        },
      }),
    }),
  };

  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  redeemCodes: { __name: "codes", id: "id", code: "code" },
  redemptions: {
    __name: "redemptions",
    id: "id",
    userId: "userId",
    codeId: "codeId",
    effectiveUntil: "effectiveUntil",
    redeemedAt: "redeemedAt",
  },
  auditLog: { __name: "audit" },
  users: { __name: "users", id: "id", plan: "plan" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({
    __op: "eq",
    col: typeof col === "string" ? col : (col as { toString: () => string }).toString(),
    val,
  }),
  and: (...children: unknown[]) => ({ __op: "and", children }),
  gt: (col: unknown, val: unknown) => ({
    __op: "gt",
    col: typeof col === "string" ? col : (col as { toString: () => string }).toString(),
    val,
  }),
  isNull: () => ({ __op: "isnull" }),
  desc: () => ({}),
}));

vi.mock("@/lib/billing/effective-plan", () => ({
  syncUsersPlanColumn: async () => {},
}));

import { redeemCode } from "@/lib/billing/redeem";

beforeEach(() => {
  hoist.state.codes = [];
  hoist.state.redemptions = [];
  hoist.state.audit = [];
  hoist.state.idSeq = 0;
});

function seedCode(partial: Partial<CodeRow> = {}): CodeRow {
  const row: CodeRow = {
    id: "c-1",
    code: "STEADII-F-XXXX-XXXX-XXXX",
    type: "friend",
    durationDays: 30,
    maxUses: 1,
    usesCount: 0,
    note: null,
    expiresAt: null,
    disabledAt: null,
    createdAt: new Date(),
    ...partial,
  };
  hoist.state.codes.push(row);
  return row;
}

describe("redeemCode", () => {
  it("NOT_FOUND for unknown code", async () => {
    const r = await redeemCode({ userId: "u", code: "NOPE" });
    expect(r).toEqual({ ok: false, code: "NOT_FOUND", message: "That code isn't valid." });
  });

  it("NOT_FOUND when code is empty", async () => {
    const r = await redeemCode({ userId: "u", code: "" });
    expect(r.ok).toBe(false);
  });

  it("DISABLED when disabledAt is set", async () => {
    seedCode({ disabledAt: new Date() });
    const r = await redeemCode({
      userId: "u",
      code: "STEADII-F-XXXX-XXXX-XXXX",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DISABLED");
  });

  it("EXPIRED when expiresAt is in the past", async () => {
    seedCode({ expiresAt: new Date(Date.now() - 1000) });
    const r = await redeemCode({
      userId: "u",
      code: "STEADII-F-XXXX-XXXX-XXXX",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXPIRED");
  });

  it("EXHAUSTED when usesCount >= maxUses", async () => {
    seedCode({ maxUses: 1, usesCount: 1 });
    const r = await redeemCode({
      userId: "u",
      code: "STEADII-F-XXXX-XXXX-XXXX",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXHAUSTED");
  });

  it("creates a redemption, increments usage, and writes audit on success", async () => {
    seedCode();
    const r = await redeemCode({
      userId: "u",
      code: "STEADII-F-XXXX-XXXX-XXXX",
    });
    expect(r.ok).toBe(true);
    expect(hoist.state.redemptions).toHaveLength(1);
    expect(hoist.state.codes[0].usesCount).toBe(1);
    expect(
      hoist.state.audit.some((a) => a.action === "redeem.friend")
    ).toBe(true);
  });

  it("returns an effectiveUntil roughly durationDays in the future", async () => {
    seedCode({ durationDays: 30 });
    const r = await redeemCode({
      userId: "u",
      code: "STEADII-F-XXXX-XXXX-XXXX",
    });
    if (!r.ok) throw new Error("expected success");
    const daysAhead = (r.effectiveUntil.getTime() - Date.now()) / (24 * 3600_000);
    expect(daysAhead).toBeGreaterThan(29);
    expect(daysAhead).toBeLessThanOrEqual(30);
  });
});
