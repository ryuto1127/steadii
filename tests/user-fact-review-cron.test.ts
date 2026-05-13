import { describe, it, expect } from "vitest";

// engineer-48 — light-weight cron test. The full cron handler exercises
// QStash verification + db queries, which are covered by the broader
// cron-heartbeat / pre-brief-cron suites. Here we lock down the
// dedupKey shape so the same fact doesn't double-surface in one window.

import { buildDedupKey } from "@/lib/agent/proactive/dedup";

describe("user_fact_review dedup", () => {
  it("derives a stable hash from (issueType, factId)", () => {
    const a = buildDedupKey("user_fact_review", ["fact-1"]);
    const b = buildDedupKey("user_fact_review", ["fact-1"]);
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("differs across fact ids", () => {
    const a = buildDedupKey("user_fact_review", ["fact-1"]);
    const b = buildDedupKey("user_fact_review", ["fact-2"]);
    expect(a).not.toBe(b);
  });

  it("differs from other issue types with the same source id", () => {
    const a = buildDedupKey("user_fact_review", ["fact-1"]);
    const b = buildDedupKey("syllabus_calendar_ambiguity", ["fact-1"]);
    expect(a).not.toBe(b);
  });
});
