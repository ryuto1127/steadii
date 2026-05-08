import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-38 — writing-style learner. Verifies:
//   1. early return when fewer than MIN_SIGNAL_ROWS (5) edit-delta pairs exist
//   2. extracts rules from the LLM and upserts them into agent_rules with
//      scope='writing_style' + source='edit_delta_learner'
//   3. legacy learner-sourced rules are soft-deleted before the new slate
//      gets persisted (so removed rules don't ghost forward)

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const agentRulesSchema = {
  id: tag("agentRules.id"),
  userId: tag("agentRules.userId"),
  scope: tag("agentRules.scope"),
  matchValue: tag("agentRules.matchValue"),
  matchNormalized: tag("agentRules.matchNormalized"),
  source: tag("agentRules.source"),
  reason: tag("agentRules.reason"),
  enabled: tag("agentRules.enabled"),
  deletedAt: tag("agentRules.deletedAt"),
};

const agentSenderFeedbackSchema = {
  id: tag("agentSenderFeedback.id"),
  userId: tag("agentSenderFeedback.userId"),
  originalDraftBody: tag("agentSenderFeedback.originalDraftBody"),
  editedBody: tag("agentSenderFeedback.editedBody"),
  createdAt: tag("agentSenderFeedback.createdAt"),
};

vi.mock("@/lib/db/schema", () => ({
  agentRules: agentRulesSchema,
  agentSenderFeedback: agentSenderFeedbackSchema,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNotNull: (col: unknown) => ({ kind: "isNotNull", col }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
  desc: (col: unknown) => ({ kind: "desc", col }),
}));

const fbRows: unknown[] = [];
const updateCalls: Array<{ table: unknown; set: unknown; where: unknown }> = [];
const insertCalls: Array<{ table: unknown; values: unknown }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => fbRows,
          }),
          limit: async () => fbRows,
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: (where: unknown) => {
          updateCalls.push({ table, set, where });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: () => {
          insertCalls.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

// Fake OpenAI returns rules with the JSON schema we asked for.
let stubbedRules: string[] = [];
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ rules: stubbedRules }),
              },
            },
          ],
          usage: { prompt_tokens: 800, completion_tokens: 60 },
        }),
      },
    },
  }),
}));

vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({
    usd: 0.005,
    credits: 1,
    usageId: "usage-style-1",
  }),
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));

beforeEach(() => {
  fbRows.length = 0;
  updateCalls.length = 0;
  insertCalls.length = 0;
  stubbedRules = [];
});

describe("extractWritingStyleRules", () => {
  it("returns empty + writes nothing when fewer than 5 signal pairs exist", async () => {
    fbRows.push(
      { original: "ご確認お願いします。", edited: "確認お願いします。" },
      { original: "ご検討よろしくお願いします。", edited: "ご検討お願いします。" },
      { original: "Thanks!", edited: "Thanks." }
    );
    stubbedRules = ["should never be returned"];

    const { extractWritingStyleRules } = await import(
      "@/lib/agent/email/style-learner"
    );
    const out = await extractWritingStyleRules("u1");
    expect(out.rules).toEqual([]);
    expect(out.signalCount).toBe(3);
    expect(out.rulesWritten).toBe(0);
    expect(insertCalls.length).toBe(0);
  });

  it("upserts rules with scope='writing_style' and source='edit_delta_learner' when ≥5 pairs", async () => {
    for (let i = 0; i < 6; i++) {
      fbRows.push({
        original: `original ${i}`,
        edited: `edited ${i}`,
      });
    }
    stubbedRules = [
      "Use 確認 instead of ご確認.",
      "Drop trailing よろしく when the recipient is a peer.",
    ];

    const { extractWritingStyleRules } = await import(
      "@/lib/agent/email/style-learner"
    );
    const out = await extractWritingStyleRules("u1");

    expect(out.signalCount).toBe(6);
    expect(out.rules).toEqual(stubbedRules);
    expect(out.rulesWritten).toBe(2);
    expect(insertCalls.length).toBe(2);
    for (const call of insertCalls) {
      const v = call.values as {
        scope: string;
        source: string;
        matchValue: string;
        userId: string;
        reason: string;
      };
      expect(v.scope).toBe("writing_style");
      expect(v.source).toBe("edit_delta_learner");
      expect(v.matchValue).toBe("*");
      expect(v.userId).toBe("u1");
      expect(stubbedRules).toContain(v.reason);
    }
  });

  it("soft-deletes prior learner-sourced rules before inserting the fresh slate", async () => {
    for (let i = 0; i < 6; i++) {
      fbRows.push({
        original: `original ${i}`,
        edited: `edited ${i}`,
      });
    }
    stubbedRules = ["Use 確認 instead of ご確認."];

    const { extractWritingStyleRules } = await import(
      "@/lib/agent/email/style-learner"
    );
    await extractWritingStyleRules("u1");

    // The first update call MUST be the soft-delete sweep on
    // agent_rules — that's how stale rules drop out of the prompt.
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const first = updateCalls[0];
    expect(first?.table).toBe(agentRulesSchema);
    const set = first?.set as { deletedAt: Date | null; enabled: boolean };
    expect(set.deletedAt).toBeInstanceOf(Date);
    expect(set.enabled).toBe(false);
  });

  it("filters out pairs with whitespace-only diffs (treats them as not signal)", async () => {
    // The query already filters nulls, but the in-memory filter also
    // drops rows where original === edited. This guards against a
    // future refactor that loosens the SQL filter and forgets the JS
    // one.
    for (let i = 0; i < 4; i++) {
      fbRows.push({
        original: "same body",
        edited: "same body",
      });
    }
    fbRows.push({ original: "different", edited: "DIFFERENT" });
    stubbedRules = ["x"];

    const { extractWritingStyleRules } = await import(
      "@/lib/agent/email/style-learner"
    );
    const out = await extractWritingStyleRules("u1");
    // Only the diverging pair survives the dedup, so signalCount=1 → early return.
    expect(out.signalCount).toBe(1);
    expect(out.rulesWritten).toBe(0);
  });
});
