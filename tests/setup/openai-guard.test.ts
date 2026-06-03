// Proves the global vitest OpenAI guard (tests/setup/openai-guard.ts, wired via
// vitest.config.ts `setupFiles`) makes the real client unreachable.
//
// This file deliberately does NOT add its own
// `vi.mock("@/lib/integrations/openai/client", ...)`, so it exercises the
// global default: reaching `openai()` must throw loudly instead of opening a
// socket to the paid API. No network is touched — we assert the thrower.

import { describe, expect, it } from "vitest";

import { openai } from "@/lib/integrations/openai/client";
import { REACHED_REAL_CLIENT_MESSAGE } from "./openai-guard";

describe("global openai guard", () => {
  it("throws a descriptive error when an unmocked test reaches openai()", () => {
    expect(() => openai()).toThrowError(/Real OpenAI client reached in tests/);
  });

  it("uses the exported guard message so the failure is self-explanatory", () => {
    expect(() => openai()).toThrowError(REACHED_REAL_CLIENT_MESSAGE);
    expect(REACHED_REAL_CLIENT_MESSAGE).toContain("mock it");
    expect(REACHED_REAL_CLIENT_MESSAGE).toContain(
      "@/lib/integrations/openai/client"
    );
  });

  it("never returns a usable client (no accidental network handle)", () => {
    let returned: unknown = "sentinel";
    try {
      returned = openai();
    } catch {
      returned = "threw";
    }
    expect(returned).toBe("threw");
  });
});
