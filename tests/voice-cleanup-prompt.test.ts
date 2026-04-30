import { describe, expect, it } from "vitest";
import {
  VOICE_CLEANUP_SYSTEM_PROMPT,
  VOICE_SHORTEN_SYSTEM_PROMPT,
  buildCleanupUserMessage,
  buildShortenUserMessage,
} from "@/lib/voice/cleanup-prompt";

// The cleanup pipeline is two parts:
//   1. The locked production prompt — frozen by `project_voice_input.md`.
//      We snapshot the rules + few-shot examples here so any drift from
//      the locked spec fails fast in CI.
//   2. The per-call user message construction (raw transcript → INPUT/
//      OUTPUT framing).
// The actual GPT-5.4 Mini call is exercised at the integration layer in
// voice-route.test.ts.

describe("VOICE_CLEANUP_SYSTEM_PROMPT", () => {
  it("preserves all 11 numbered rules from the locked spec", () => {
    for (let n = 1; n <= 11; n++) {
      expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(
        new RegExp(`(^|\\n)${n}\\.`)
      );
    }
  });

  it("instructs the model to preserve self-corrections (latest wins)", () => {
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(/self-correction/i);
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("5/16");
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("5/17");
  });

  it("preserves JP+EN code-switching as written", () => {
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(/code-switching/i);
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("MAT223");
  });

  it("lists JP and EN fillers to remove", () => {
    for (const filler of ["えー", "あの", "なんか", "um", "uh", "like"]) {
      expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain(filler);
    }
  });

  it("preserves proper-noun garbling correction examples", () => {
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("マット223");
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("CS110");
  });

  it("forbids the model from adding information or summarizing", () => {
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(
      /Never add information not in the transcript/i
    );
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(/Never summarize/i);
  });

  it("constrains output to ONLY the cleaned text (no preamble)", () => {
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(
      /Output ONLY the cleaned text/i
    );
  });

  it("includes the three locked few-shot examples", () => {
    // Example 1: JP self-correction with filler removal.
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain(
      "明日のテスト、リスケしてもらえないかな？"
    );
    // Example 2: JP/EN code-switch with comma punctuation.
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain(
      "MAT223 の今日の lecture、行けないから notes 欲しいな。"
    );
    // Example 3: numeric self-correction.
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toContain("5/17に変更したい。");
  });
});

describe("buildCleanupUserMessage", () => {
  it("frames the raw transcript with INPUT/OUTPUT delimiters", () => {
    const out = buildCleanupUserMessage("えーと、今日の課題は？");
    expect(out).toBe("INPUT:\nえーと、今日の課題は？\n\nOUTPUT:");
  });

  it("does not modify the input transcript", () => {
    const raw = "MAT223 のレポート due tomorrow";
    expect(buildCleanupUserMessage(raw)).toContain(raw);
  });
});

describe("VOICE_CLEANUP_SYSTEM_PROMPT (Phase 2: USER ACADEMIC CONTEXT awareness)", () => {
  it("rule #6 references the per-user USER ACADEMIC CONTEXT block", () => {
    // Phase 2 extends rule #6 — the universal prompt now points at the
    // follow-up system message that holds the user's classes / topics.
    expect(VOICE_CLEANUP_SYSTEM_PROMPT).toMatch(/USER ACADEMIC CONTEXT/);
  });
});

describe("VOICE_SHORTEN_SYSTEM_PROMPT (Phase 2 — long voice msg summary)", () => {
  it("preserves all 5 numbered rules from the locked spec", () => {
    for (let n = 1; n <= 5; n++) {
      expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(
        new RegExp(`(^|\\n)${n}\\.`)
      );
    }
  });

  it("instructs the model to preserve the actionable core", () => {
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(
      /Preserve the actionable core/i
    );
  });

  it("forbids translation or register shifts", () => {
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(/Same language and tone/i);
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(/Do not translate/i);
  });

  it("targets ~30-50% of input length and returns input unchanged when already concise", () => {
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(/30-50%/);
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(/already concise/i);
  });

  it("constrains output to ONLY the shortened text (no preamble)", () => {
    expect(VOICE_SHORTEN_SYSTEM_PROMPT).toMatch(
      /Output ONLY the shortened text/i
    );
  });
});

describe("buildShortenUserMessage", () => {
  it("frames the cleaned transcript with INPUT/OUTPUT delimiters", () => {
    const out = buildShortenUserMessage("today I want to discuss many things");
    expect(out).toBe("INPUT:\ntoday I want to discuss many things\n\nOUTPUT:");
  });
});
