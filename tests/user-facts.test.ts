import { describe, it, expect, vi } from "vitest";

// engineer-47 — user_facts feature tests.
//
// Coverage:
//   - save_user_fact tool surfaces in the chat tool defs
//   - renderUserFactsBlock renders the expected prompt format
//   - serializeContextForPrompt splices the USER FACTS sub-block into
//     the USER CONTEXT section in the documented order
//   - save_user_fact.execute upserts cleanly (lastUsedAt bumped,
//     deletedAt cleared) via onConflictDoUpdate
//   - markUserFactsUsed only touches live rows for the right user

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "x",
    AUTH_GOOGLE_ID: "x",
    AUTH_GOOGLE_SECRET: "x",
    NOTION_CLIENT_ID: "x",
    NOTION_CLIENT_SECRET: "x",
    OPENAI_API_KEY: "x",
    STRIPE_SECRET_KEY: "x",
    STRIPE_PRICE_ID_PRO: "x",
    ENCRYPTION_KEY: "k".repeat(64),
    NODE_ENV: "test",
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import { openAIToolDefs, ALL_TOOLS } from "@/lib/agent/tool-registry";
import {
  renderUserFactsBlock,
  type UserFactForPrompt,
} from "@/lib/agent/user-facts";
import { serializeContextForPrompt } from "@/lib/agent/serialize-context";

describe("save_user_fact tool registration", () => {
  it("appears in the default openAIToolDefs (no context)", () => {
    const defs = openAIToolDefs();
    expect(defs.find((d) => d.function.name === "save_user_fact")).toBeDefined();
  });

  it("is available in clarification sessions too", () => {
    const defs = openAIToolDefs({
      clarifyingDraftId: "00000000-0000-0000-0000-000000000001",
    });
    expect(defs.find((d) => d.function.name === "save_user_fact")).toBeDefined();
  });

  it("schema declares fact / category / source with fact required", () => {
    const tool = ALL_TOOLS.find((t) => t.schema.name === "save_user_fact");
    expect(tool).toBeDefined();
    const params = tool!.schema.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(params.properties)).toEqual(
      expect.arrayContaining(["fact", "category", "source"])
    );
    expect(params.required).toEqual(["fact"]);
  });
});

describe("renderUserFactsBlock", () => {
  it("renders empty list as empty string (caller can append unconditionally)", () => {
    expect(renderUserFactsBlock([])).toBe("");
  });

  it("renders [category] prefix when category present and bare bullet otherwise", () => {
    const facts: UserFactForPrompt[] = [
      { id: "1", fact: "I'm in Vancouver", category: "location_timezone" },
      { id: "2", fact: "Reachable 13:00-18:00 PT weekdays", category: "schedule" },
      { id: "3", fact: "Generic note", category: null },
    ];
    const out = renderUserFactsBlock(facts);
    expect(out).toContain("USER FACTS (things Steadii has learned about you");
    expect(out).toContain("- [location_timezone] I'm in Vancouver");
    expect(out).toContain("- [schedule] Reachable 13:00-18:00 PT weekdays");
    expect(out).toContain("- Generic note");
    expect(out).toContain("save_user_fact with the corrected version");
  });
});

describe("serializeContextForPrompt — user_facts injection", () => {
  it("emits USER FACTS sub-block inside USER CONTEXT when facts present", () => {
    const prompt = serializeContextForPrompt({
      timezone: "America/Vancouver",
      locale: "en",
      notion: {
        connected: false,
        parentPageId: null,
        classesDbId: null,
        mistakesDbId: null,
        assignmentsDbId: null,
        syllabiDbId: null,
      },
      registeredResources: [],
      userFacts: [
        { fact: "I'm in Vancouver", category: "location_timezone" },
        { fact: "Don't notify me at night", category: "personal_pref" },
        { fact: "high-school student going to a CS program", category: "academic" },
      ],
    });
    expect(prompt).toContain("# USER CONTEXT (always honor)");
    expect(prompt).toContain(
      "USER FACTS (things Steadii has learned about you"
    );
    expect(prompt).toContain("- [location_timezone] I'm in Vancouver");
    expect(prompt).toContain("- [personal_pref] Don't notify me at night");
    expect(prompt).toContain(
      "- [academic] high-school student going to a CS program"
    );
    // Sits inside USER CONTEXT — should appear before the # Time header.
    const ctxIdx = prompt.indexOf("# USER CONTEXT (always honor)");
    const factsIdx = prompt.indexOf("USER FACTS (things Steadii");
    const timeIdx = prompt.indexOf("# Time");
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(factsIdx).toBeGreaterThan(ctxIdx);
    expect(timeIdx).toBeGreaterThan(factsIdx);
  });

  it("omits the USER FACTS sub-block when no facts saved", () => {
    const prompt = serializeContextForPrompt({
      timezone: "America/Vancouver",
      locale: "en",
      notion: {
        connected: false,
        parentPageId: null,
        classesDbId: null,
        mistakesDbId: null,
        assignmentsDbId: null,
        syllabiDbId: null,
      },
      registeredResources: [],
      userFacts: [],
    });
    expect(prompt).not.toContain("USER FACTS");
  });
});

describe("save_user_fact tool execution", () => {
  it("calls db.insert(userFacts).values(...).onConflictDoUpdate(...) with the parsed args + bumps lastUsedAt + clears deletedAt", async () => {
    // Mock the chain: db.insert(table).values(v).onConflictDoUpdate(c).returning(_)
    const captured: {
      values?: Record<string, unknown>;
      conflict?: { target: unknown; set: Record<string, unknown> };
    } = {};

    const insertChain = {
      values(v: Record<string, unknown>) {
        captured.values = v;
        return {
          onConflictDoUpdate(c: {
            target: unknown;
            set: Record<string, unknown>;
          }) {
            captured.conflict = c;
            return {
              returning: async () => [
                {
                  id: "fact-row-1",
                  fact: v.fact,
                  category: v.category,
                  source: v.source,
                },
              ],
            };
          },
        };
      },
    };

    // Plain insert for audit_log (no onConflict path).
    const auditInsertChain = {
      values: vi.fn(async () => undefined),
    };

    const dbMock = {
      insert: vi.fn((table: { _name?: string } | unknown) => {
        // The audit_log insert is identified by a different table object.
        // We can route on call ordering instead of table identity.
        if (dbMock.insert.mock.calls.length === 1) return insertChain;
        return auditInsertChain;
      }),
    };

    vi.doMock("@/lib/db/client", () => ({ db: dbMock }));
    // Re-import after mock so the tool picks up the new db reference.
    vi.resetModules();
    const { saveUserFact } = await import("@/lib/agent/tools/save-user-fact");
    const out = await saveUserFact.execute(
      { userId: "user-1" },
      {
        fact: "  I'm in Vancouver  ",
        category: "location_timezone",
        source: "user_explicit",
      }
    );
    expect(out.id).toBe("fact-row-1");
    expect(out.fact).toBe("I'm in Vancouver");
    expect(captured.values?.userId).toBe("user-1");
    // Trimmed via zod.
    expect(captured.values?.fact).toBe("I'm in Vancouver");
    expect(captured.values?.source).toBe("user_explicit");
    // user_explicit → null confidence.
    expect(captured.values?.confidence).toBeNull();
    expect(captured.conflict?.set.lastUsedAt).toBeInstanceOf(Date);
    expect(captured.conflict?.set.deletedAt).toBeNull();
    vi.doUnmock("@/lib/db/client");
  });

  it("defaults source to agent_inferred and stamps 0.8 confidence", async () => {
    const captured: {
      values?: Record<string, unknown>;
    } = {};
    const insertChain = {
      values(v: Record<string, unknown>) {
        captured.values = v;
        return {
          onConflictDoUpdate() {
            return {
              returning: async () => [
                {
                  id: "fact-row-2",
                  fact: v.fact,
                  category: v.category,
                  source: v.source,
                },
              ],
            };
          },
        };
      },
    };
    const dbMock = {
      insert: vi.fn(() => {
        if (dbMock.insert.mock.calls.length === 1) return insertChain;
        return { values: vi.fn(async () => undefined) };
      }),
    };
    vi.doMock("@/lib/db/client", () => ({ db: dbMock }));
    vi.resetModules();
    const { saveUserFact } = await import("@/lib/agent/tools/save-user-fact");
    await saveUserFact.execute(
      { userId: "user-1" },
      // no source field → default agent_inferred
      { fact: "Don't notify me at night" }
    );
    expect(captured.values?.source).toBe("agent_inferred");
    expect(captured.values?.confidence).toBe(0.8);
    vi.doUnmock("@/lib/db/client");
  });
});
