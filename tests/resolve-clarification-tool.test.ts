import { describe, it, expect, beforeEach, vi } from "vitest";

// engineer-46 — resolve_clarification tool. Drives the tool's execute()
// against a stubbed db and asserts:
//   * input validation rejects malformed args
//   * forbidden internal tool-name leaks in `reasoning` throw
//   * the happy path runs an insert + update inside a transaction
//   * the chat row's clarifyingDraftId is nulled after the resolve
//   * an audit row is written

vi.mock("server-only", () => ({}));

// Drizzle ORM helpers — the tool only uses `eq` and `and` for the WHERE
// clauses; we stub them as identity-ish functions and inspect call
// shapes via the db mock instead.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...parts: unknown[]) => ({ op: "and", parts }),
}));

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: "agent_drafts.id", userId: "agent_drafts.user_id" },
  chats: {
    id: "chats.id",
    userId: "chats.user_id",
    clarifyingDraftId: "chats.clarifying_draft_id",
  },
  auditLog: {},
}));

// Audit logger — assert it's called once with the right action +
// subAction. Side-effect-free fake.
const auditCalls: unknown[] = [];
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async (args: unknown) => {
    auditCalls.push(args);
  },
}));

type OriginalDraft = {
  id: string;
  userId: string;
  inboxItemId: string;
  classifyModel: string | null;
  draftModel: string | null;
  riskTier: "low" | "medium" | "high";
  action: "ask_clarifying" | "draft_reply" | "notify_only";
  status: "pending" | "dismissed";
};

type DbState = {
  draft: OriginalDraft | null;
  insertedDraft: Record<string, unknown> | null;
  draftStatusUpdates: Array<{ where: unknown; patch: Record<string, unknown> }>;
  chatNullCalls: number;
};

const state: DbState = {
  draft: null,
  insertedDraft: null,
  draftStatusUpdates: [],
  chatNullCalls: 0,
};

vi.mock("@/lib/db/client", () => {
  function buildSelectChain(rows: unknown[]) {
    return {
      from: () => ({
        innerJoin: () => buildSelectChain(rows),
        where: () => ({
          limit: async () => rows,
        }),
      }),
    };
  }
  const dbRoot = {
    select: () => buildSelectChain(state.draft ? [state.draft] : []),
    transaction: async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            state.insertedDraft = v;
            return {
              returning: async () => [{ id: "new-draft-id-uuid" }],
            };
          },
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => ({
            where: async (where: unknown) => {
              state.draftStatusUpdates.push({ where, patch });
            },
          }),
        }),
      };
      return fn(tx);
    },
    update: () => ({
      set: () => ({
        where: async () => {
          state.chatNullCalls += 1;
        },
      }),
    }),
  };
  return { db: dbRoot };
});

import { resolveClarification } from "@/lib/agent/tools/resolve-clarification";

const ORIGINAL_DRAFT_ID = "12345678-1234-4abc-8def-123456789012";
const INBOX_ITEM_ID = "23456789-1234-4abc-8def-123456789013";

function freshDraft(
  overrides: Partial<OriginalDraft> = {}
): OriginalDraft {
  return {
    id: ORIGINAL_DRAFT_ID,
    userId: "user-1",
    inboxItemId: INBOX_ITEM_ID,
    classifyModel: "gpt-5.4-mini",
    draftModel: "gpt-5.4",
    riskTier: "medium",
    action: "ask_clarifying",
    status: "pending",
    ...overrides,
  };
}

function happyPathArgs() {
  return {
    originalDraftId: ORIGINAL_DRAFT_ID,
    newAction: "draft_reply" as const,
    draftBody: "Hi — Tuesday 10:00 PT works for me. Looking forward to it.",
    draftSubject: "Re: Interview slots",
    draftTo: ["recruiter@acme-travel.example.co.jp"],
    draftCc: [],
    reasoning:
      "Confirmed with the student via chat that they prefer the Tuesday slot in PT. Drafted a reply locking that in.",
  };
}

beforeEach(() => {
  state.draft = freshDraft();
  state.insertedDraft = null;
  state.draftStatusUpdates = [];
  state.chatNullCalls = 0;
  auditCalls.length = 0;
});

describe("resolveClarification.execute", () => {
  it("happy path inserts a new draft, dismisses the original, and writes audit", async () => {
    const res = await resolveClarification.execute(
      { userId: "user-1" },
      happyPathArgs()
    );
    expect(res).toEqual({
      newDraftId: "new-draft-id-uuid",
      status: "resolved",
    });
    // Inserted row carries the resolved values + reuses the original
    // inboxItemId + riskTier.
    expect(state.insertedDraft).toMatchObject({
      userId: "user-1",
      inboxItemId: INBOX_ITEM_ID,
      action: "draft_reply",
      status: "pending",
      draftSubject: "Re: Interview slots",
      draftTo: ["recruiter@acme-travel.example.co.jp"],
      riskTier: "medium",
    });
    // Exactly one status-flip update inside the transaction.
    expect(state.draftStatusUpdates).toHaveLength(1);
    expect(state.draftStatusUpdates[0].patch).toMatchObject({
      status: "dismissed",
    });
    // Chat row's clarifyingDraftId was nulled (best-effort cleanup).
    expect(state.chatNullCalls).toBe(1);
    // Audit row was written with the right sub-action.
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "email_l2_completed",
      result: "success",
      detail: { subAction: "clarification_resolved_via_chat" },
    });
  });

  it("throws when the original draft isn't found or isn't owned by user", async () => {
    state.draft = null;
    await expect(
      resolveClarification.execute({ userId: "user-1" }, happyPathArgs())
    ).rejects.toThrow(/not found/);
  });

  it("throws when the original draft action is not ask_clarifying", async () => {
    state.draft = freshDraft({ action: "draft_reply" });
    await expect(
      resolveClarification.execute({ userId: "user-1" }, happyPathArgs())
    ).rejects.toThrow(/not "ask_clarifying"/);
  });

  it("throws when the original draft status is not pending", async () => {
    state.draft = freshDraft({ status: "dismissed" });
    await expect(
      resolveClarification.execute({ userId: "user-1" }, happyPathArgs())
    ).rejects.toThrow(/not "pending"/);
  });

  it("forbids internal tool-name leaks in reasoning (glass-box transparency)", async () => {
    await expect(
      resolveClarification.execute(
        { userId: "user-1" },
        {
          ...happyPathArgs(),
          reasoning:
            "Called write_draft after lookup_contact_persona returned a hit.",
        }
      )
    ).rejects.toThrow(/leaks internal tool name/);
  });

  it("rejects malformed args via zod (missing required field)", async () => {
    await expect(
      resolveClarification.execute(
        { userId: "user-1" },
        {
          // Missing draftBody — zod schema rejects.
          originalDraftId: ORIGINAL_DRAFT_ID,
          newAction: "draft_reply",
          draftSubject: "x",
          draftTo: ["x@x.com"],
          reasoning: "ok",
        } as unknown as Parameters<typeof resolveClarification.execute>[1]
      )
    ).rejects.toThrow();
  });
});
