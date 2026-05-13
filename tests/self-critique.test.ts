import { describe, expect, it } from "vitest";

import {
  detectPlaceholderLeak,
  buildPlaceholderLeakCorrection,
} from "@/lib/agent/self-critique";

// 2026-05-12 sparring inline — placeholder-leak detector for the
// chat orchestrator's self-critique pass. Regex-only, deterministic;
// false positives are worse than false negatives at this stage (a
// false positive triggers an extra LLM call; a false negative ships
// templated output to the user).

describe("detectPlaceholderLeak", () => {
  describe("〇〇 / ○○ / ◯◯ placeholder bullets", () => {
    it("flags doubled 〇〇 in a JA letter template", () => {
      const text =
        "お世話になっております。〇〇です。\nご連絡ありがとうございます。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("〇〇");
    });

    it("flags ○○ (half-width? actually full-width too) variant", () => {
      const r = detectPlaceholderLeak("○○様、よろしくお願いします");
      expect(r.hasLeak).toBe(true);
    });

    it("flags ◯◯ variant", () => {
      const r = detectPlaceholderLeak("◯◯部の◯◯と申します");
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag a single 〇 (legitimate Japanese punctuation)", () => {
      // 〇 alone is sometimes used as a list-marker or "good" symbol
      const r = detectPlaceholderLeak("評価: 〇\nコメントなし");
      expect(r.hasLeak).toBe(false);
    });
  });

  describe("curly-brace placeholders", () => {
    it("flags {name}", () => {
      const r = detectPlaceholderLeak(
        "Dear {name},\nThank you for reaching out."
      );
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("{placeholder}");
    });

    it("flags {date}", () => {
      const r = detectPlaceholderLeak("Meeting on {date} at 10am.");
      expect(r.hasLeak).toBe(true);
    });

    it("flags JP-script placeholder {名前}", () => {
      const r = detectPlaceholderLeak("{名前}様、お疲れ様です。");
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag long bracketed identifiers (code refs)", () => {
      // Long alphanumeric in braces likely a code snippet, not a slot
      const r = detectPlaceholderLeak(
        "Use the {someLongVariableNameThatIsCodeNotPlaceholder} prop"
      );
      expect(r.hasLeak).toBe(false);
    });

    it("does NOT flag JSON-like content that's actually data", () => {
      const r = detectPlaceholderLeak(
        'The API returned {"status": "ok"} successfully'
      );
      expect(r.hasLeak).toBe(false);
    });
  });

  describe("[TBD] / [...] / [未定] brackets", () => {
    it("flags [TBD]", () => {
      const r = detectPlaceholderLeak("Date: [TBD]");
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("[TBD]/[...]");
    });

    it("flags lower-case [tbd]", () => {
      const r = detectPlaceholderLeak("location: [tbd]");
      expect(r.hasLeak).toBe(true);
    });

    it("flags [未定]", () => {
      const r = detectPlaceholderLeak("締切: [未定]");
      expect(r.hasLeak).toBe(true);
    });

    it("flags [...]", () => {
      const r = detectPlaceholderLeak("Details: [...]");
      expect(r.hasLeak).toBe(true);
    });

    it("flags […] (single-char ellipsis)", () => {
      const r = detectPlaceholderLeak("Notes: […]");
      expect(r.hasLeak).toBe(true);
    });
  });

  describe("time-placeholder shapes xx:xx / XX月XX日", () => {
    it("flags xx:xx", () => {
      const r = detectPlaceholderLeak("第一希望：xx月xx日（x）　xx:xx〜xx:xx");
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("xx:xx");
    });

    it("flags XX:XX (upper-case)", () => {
      const r = detectPlaceholderLeak("Time: XX:XX");
      expect(r.hasLeak).toBe(true);
    });

    it("flags XX月XX日", () => {
      const r = detectPlaceholderLeak("候補: XX月XX日 14:00");
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("XX月XX日");
    });

    it("does NOT flag valid times like 10:00", () => {
      const r = detectPlaceholderLeak("10:00–11:00 JST が候補です");
      expect(r.hasLeak).toBe(false);
    });
  });

  describe("clean output (no leaks)", () => {
    it("does not flag a fully-grounded JA email reply", () => {
      const text = `お世話になっております。田中 太郎です。
ご連絡ありがとうございます。

下記の通り、希望日程をお送りいたします。
第一希望：5月15日(金) 11:30〜12:00 JST (バンクーバー: 5月14日(木) 19:30〜20:00 PT)
第二希望：5月19日(火) 16:30〜17:00 JST (バンクーバー: 5月19日(火) 00:30〜01:00 PT)
第三希望：5月22日(金) 13:30〜14:00 JST (バンクーバー: 5月21日(木) 21:30〜22:00 PT)

何卒よろしくお願いいたします。`;
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
      expect(r.matched).toHaveLength(0);
    });

    it("does not flag an EN summary", () => {
      const text =
        "Tomorrow you have CS 348 at 10:00 and Office Hours with Prof. Tanaka at 14:00.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });
  });

  it("returns multiple matches when multiple leak types present", () => {
    const text = "Dear {name},\nMeeting on XX月XX日.\nLocation: [TBD]";
    const r = detectPlaceholderLeak(text);
    expect(r.hasLeak).toBe(true);
    expect(r.matched.length).toBeGreaterThanOrEqual(3);
    expect(r.matched).toContain("{placeholder}");
    expect(r.matched).toContain("XX月XX日");
    expect(r.matched).toContain("[TBD]/[...]");
  });
});

describe("buildPlaceholderLeakCorrection", () => {
  it("includes the matched token names", () => {
    const msg = buildPlaceholderLeakCorrection(["〇〇", "{placeholder}"]);
    expect(msg).toContain("〇〇");
    expect(msg).toContain("{placeholder}");
  });

  it("references the failure-mode name PLACEHOLDER_LEAK", () => {
    const msg = buildPlaceholderLeakCorrection(["xx:xx"]);
    expect(msg).toContain("PLACEHOLDER_LEAK");
  });

  it("instructs the agent to re-fetch + re-write, not paper over", () => {
    const msg = buildPlaceholderLeakCorrection(["〇〇"]);
    expect(msg.toLowerCase()).toContain("tool");
    expect(msg).toContain("Re-do");
  });
});
