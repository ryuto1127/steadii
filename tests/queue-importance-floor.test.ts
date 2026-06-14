import { describe, expect, it } from "vitest";

// 2026-06-13 — Wave A noise reduction. The FYI importance floor is now
// UNIFIED across the email digest AND the in-app queue. This is the
// single shared predicate both surfaces import (no db / server-only), so
// it is unit-testable in isolation. The behavioral contract:
//   - notify_only (FYI) surfaces ONLY at high/medium riskTier;
//   - a LOW-risk notify_only does NOT enter either surface;
//   - draft_reply / ask_clarifying always pass (they owe a user decision).

import { passesImportanceFloor } from "@/lib/agent/queue/importance-floor";
import type { AgentDraftAction, InboxRiskTier } from "@/lib/db/schema";

function probe(action: AgentDraftAction, riskTier: InboxRiskTier): boolean {
  return passesImportanceFloor({ action, riskTier });
}

describe("passesImportanceFloor — unified FYI floor", () => {
  it("EXCLUDES low-risk notify_only (the noise the floor suppresses)", () => {
    expect(probe("notify_only", "low")).toBe(false);
  });

  it("INCLUDES high/medium-risk notify_only", () => {
    expect(probe("notify_only", "high")).toBe(true);
    expect(probe("notify_only", "medium")).toBe(true);
  });

  it("ALWAYS includes action-required drafts regardless of risk", () => {
    for (const tier of ["low", "medium", "high"] as InboxRiskTier[]) {
      expect(probe("draft_reply", tier)).toBe(true);
      expect(probe("ask_clarifying", tier)).toBe(true);
    }
  });
});
