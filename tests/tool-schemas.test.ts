import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
  }),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/notion/client", () => ({
  getNotionClientForUser: async () => null,
}));
vi.mock("@/lib/integrations/google/calendar", () => ({
  getCalendarForUser: async () => ({}),
}));

import { NOTION_TOOLS } from "@/lib/agent/tools/notion";
import { CALENDAR_TOOLS } from "@/lib/agent/tools/calendar";
import { toOpenAIToolDefinition } from "@/lib/agent/tools/types";

describe("Tool schema shape", () => {
  const all = [...NOTION_TOOLS, ...CALENDAR_TOOLS];

  it("every tool has a name, description, mutability, and a JSON Schema object", () => {
    for (const t of all) {
      expect(t.schema.name).toMatch(/^[a-z_]+$/);
      expect(typeof t.schema.description).toBe("string");
      expect(["read", "write", "destructive"]).toContain(t.schema.mutability);
      expect(t.schema.parameters).toHaveProperty("type", "object");
    }
  });

  it("destructive tools include both notion_delete_page and calendar_delete_event", () => {
    const destructive = all.filter((t) => t.schema.mutability === "destructive");
    const names = destructive.map((t) => t.schema.name);
    expect(names).toContain("notion_delete_page");
    expect(names).toContain("calendar_delete_event");
  });

  it("all tool names are unique", () => {
    const names = all.map((t) => t.schema.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("toOpenAIToolDefinition produces correct OpenAI envelope", () => {
    const def = toOpenAIToolDefinition(all[0].schema);
    expect(def.type).toBe("function");
    expect(def.function.name).toBe(all[0].schema.name);
    expect(def.function.parameters).toBeDefined();
  });
});
