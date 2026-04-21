import { describe, expect, it, vi, beforeEach } from "vitest";

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

const hoist = vi.hoisted(() => {
  const state = {
    codes: [] as CodeRow[],
    redemptions: [] as Record<string, unknown>[],
    audit: [] as Array<Record<string, unknown>>,
    idSeq: 0,
  };

  function resolve(row: Record<string, unknown>, v: unknown): unknown {
    if (v && typeof v === "object" && (v as { __col?: string }).__col) {
      return row[(v as { __col: string }).__col];
    }
    return v;
  }

  function matches(row: Record<string, unknown>, filter: unknown): boolean {
    if (!filter) return true;
    const f = filter as { __op: string; [k: string]: unknown };
    if (f.__op === "eq") return row[f.col as string] === resolve(row, f.val);
    if (f.__op === "gt")
      return (row[f.col as string] as Date) > (resolve(row, f.val) as Date);
    if (f.__op === "lt")
      return (row[f.col as string] as number) < (resolve(row, f.val) as number);
    if (f.__op === "isnull") return row[f.col as string] == null;
    if (f.__op === "and")
      return (f.children as unknown[]).every((c) => matches(row, c));
    return true;
  }

  function sourceFor(name: string): Array<Record<string, unknown>> {
    if (name === "codes") return state.codes as unknown as Array<Record<string, unknown>>;
    if (name === "redemptions") return state.redemptions;
    if (name === "audit") return state.audit;
    return [];
  }

  function applyPatch(
    row: Record<string, unknown>,
    patch: Record<string, unknown>
  ): void {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && (v as { __sqlDelta?: number }).__sqlDelta !== undefined) {
        row[k] = ((row[k] as number) ?? 0) + (v as { __sqlDelta: number }).__sqlDelta;
      } else {
        row[k] = v;
      }
    }
  }

  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: (filter: unknown) => {
          const rows = sourceFor(table.__name).filter((r) => matches(r, filter));
          const base = {
            limit: () => rows,
            innerJoin: () => ({
              where: () => ({ orderBy: () => ({ limit: () => [] }) }),
            }),
          };
          return Object.assign(Promise.resolve(rows), base);
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
            });
          }
        } else if (table.__name === "audit") {
          state.audit.push(...(arr as Record<string, unknown>[]));
        }
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (filter: unknown) => {
          const source = sourceFor(table.__name);
          const updated: Array<Record<string, unknown>> = [];
          for (const r of source) {
            if (matches(r, filter)) {
              applyPatch(r, patch);
              updated.push({ ...r });
            }
          }
          return Object.assign(Promise.resolve(undefined), {
            returning: () => Promise.resolve(updated),
          });
        },
      }),
    }),
  };

  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  redeemCodes: {
    __name: "codes",
    id: { __col: "id" },
    code: { __col: "code" },
    usesCount: { __col: "usesCount" },
    maxUses: { __col: "maxUses" },
    disabledAt: { __col: "disabledAt" },
  },
  redemptions: {
    __name: "redemptions",
    id: { __col: "id" },
    userId: { __col: "userId" },
    codeId: { __col: "codeId" },
    effectiveUntil: { __col: "effectiveUntil" },
    redeemedAt: { __col: "redeemedAt" },
  },
  auditLog: {
    __name: "audit",
    id: { __col: "id" },
    userId: { __col: "userId" },
    action: { __col: "action" },
    createdAt: { __col: "createdAt" },
  },
  users: { __name: "users", id: { __col: "id" }, plan: { __col: "plan" } },
}));

function colOf(c: unknown): string | undefined {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && (c as { __col?: string }).__col) {
    return (c as { __col: string }).__col;
  }
  return undefined;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col: colOf(col), val }),
  and: (...children: unknown[]) => ({ __op: "and", children }),
  gt: (col: unknown, val: unknown) => ({ __op: "gt", col: colOf(col), val }),
  lt: (col: unknown, val: unknown) => ({ __op: "lt", col: colOf(col), val }),
  isNull: (col: unknown) => ({ __op: "isnull", col: colOf(col) }),
  desc: () => ({}),
  sql: (strings: TemplateStringsArray) => {
    const raw = strings.join("?");
    if (/-\s*1/.test(raw)) return { __sqlDelta: -1 };
    if (/\+\s*1/.test(raw)) return { __sqlDelta: 1 };
    return { __sqlDelta: 0 };
  },
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
    code: "STEADII-ONE-USE",
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

describe("redeem TOCTOU race", () => {
  it("exactly 1 of 5 concurrent redeem calls wins on a maxUses:1 code", async () => {
    seedCode({ maxUses: 1 });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        redeemCode({ userId: `u-${i}`, code: "STEADII-ONE-USE" })
      )
    );
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(4);
    for (const r of losses) {
      if (!r.ok) expect(r.code).toBe("EXHAUSTED");
    }
    expect(hoist.state.codes[0].usesCount).toBe(1);
    expect(hoist.state.redemptions).toHaveLength(1);
  });

  it("maxUses:3 allows exactly 3 of 10 concurrent calls", async () => {
    seedCode({ maxUses: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        redeemCode({ userId: `u-${i}`, code: "STEADII-ONE-USE" })
      )
    );
    const wins = results.filter((r) => r.ok);
    expect(wins).toHaveLength(3);
    expect(hoist.state.codes[0].usesCount).toBe(3);
    expect(hoist.state.redemptions).toHaveLength(3);
  });

  it("returns EXHAUSTED when the code is already fully consumed", async () => {
    seedCode({ maxUses: 1, usesCount: 1 });
    const r = await redeemCode({ userId: "u", code: "STEADII-ONE-USE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXHAUSTED");
  });
});
