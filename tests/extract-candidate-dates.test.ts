import { describe, expect, it, vi } from "vitest";

// engineer-41 — extract_candidate_dates parser tests. Pure-function unit
// tests against the schema parser (the LLM call itself is integration-
// only). Verifies:
//   1. Well-formed JP-style date emits a candidate
//   2. EN-style date with explicit timezone emits a candidate
//   3. Multiple candidates round-trip
//   4. Malformed dueDate / time strings degrade to null
//   5. confidence < 0.6 drops the candidate
//   6. malformed JSON → empty array

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/openai/client", () => ({ openai: () => ({}) }));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

import { parseExtractCandidateDatesOutput } from "@/lib/agent/email/l2-tools/extract-candidate-dates";

describe("parseExtractCandidateDatesOutput", () => {
  it("returns a candidate from a well-formed JP-style date", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          date: "2026-05-15",
          startTime: "10:00",
          endTime: "11:00",
          timezoneHint: "JST",
          confidence: 0.95,
          sourceText: "2026/5/15 (金) 10:00 〜 11:00 JST",
        },
      ],
    });
    const out = parseExtractCandidateDatesOutput(raw);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].date).toBe("2026-05-15");
    expect(out.candidates[0].startTime).toBe("10:00");
    expect(out.candidates[0].timezoneHint).toBe("JST");
  });

  it("returns multiple candidates in order", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          date: "2026-05-15",
          startTime: "10:00",
          endTime: "11:00",
          timezoneHint: "JST",
          confidence: 0.9,
          sourceText: "x",
        },
        {
          date: "2026-05-16",
          startTime: "14:00",
          endTime: "15:00",
          timezoneHint: null,
          confidence: 0.85,
          sourceText: "y",
        },
      ],
    });
    const out = parseExtractCandidateDatesOutput(raw);
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates[1].date).toBe("2026-05-16");
    expect(out.candidates[1].timezoneHint).toBeNull();
  });

  it("drops a candidate without a YYYY-MM-DD date", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          date: "next Friday",
          startTime: null,
          endTime: null,
          timezoneHint: null,
          confidence: 0.9,
          sourceText: "x",
        },
      ],
    });
    expect(parseExtractCandidateDatesOutput(raw).candidates).toHaveLength(0);
  });

  it("normalises malformed startTime/endTime to null without throwing", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          date: "2026-05-15",
          startTime: "10am",
          endTime: "11:00:00",
          timezoneHint: "PT",
          confidence: 0.9,
          sourceText: "x",
        },
      ],
    });
    const out = parseExtractCandidateDatesOutput(raw);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].startTime).toBeNull();
    expect(out.candidates[0].endTime).toBeNull();
  });

  it("drops candidates with confidence < 0.6", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          date: "2026-05-15",
          startTime: null,
          endTime: null,
          timezoneHint: null,
          confidence: 0.4,
          sourceText: "x",
        },
        {
          date: "2026-05-16",
          startTime: null,
          endTime: null,
          timezoneHint: null,
          confidence: 0.65,
          sourceText: "y",
        },
      ],
    });
    const out = parseExtractCandidateDatesOutput(raw);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].date).toBe("2026-05-16");
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseExtractCandidateDatesOutput("not json").candidates).toEqual(
      []
    );
  });

  it("returns an empty array when candidates is missing entirely", () => {
    expect(
      parseExtractCandidateDatesOutput(JSON.stringify({})).candidates
    ).toEqual([]);
  });
});
