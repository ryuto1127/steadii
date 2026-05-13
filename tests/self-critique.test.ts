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
      const text = `お世話になっております。畠山 竜都です。
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

  // engineer-53 — SUBJECT_LINE_FABRICATED_ON_REPLY detector. Matches
  // a `件名:` / `Subject:` line at line-start followed by `Re:`. The
  // pattern is conservative: a `Subject:` without `Re:` may be a
  // legitimate new-mail draft, so we skip those.
  describe("件名 fabricated on reply (SUBJECT_LINE_FABRICATED_ON_REPLY)", () => {
    it("flags `件名: Re: ...` at the top of a draft body", () => {
      const text = [
        "件名: Re: 次回面接日程のご連絡",
        "令和トラベル",
        "畠山 竜都です。",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("件名 fabricated on reply");
    });

    it("flags `Subject: Re: ...` (English)", () => {
      const text = [
        "Subject: Re: Interview slots",
        "",
        "Hi Reiwa Travel,",
        "Thanks for the slots.",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("件名 fabricated on reply");
    });

    it("flags `件名：Re:` with full-width colon", () => {
      const text = "件名：Re: 面接の件\n本文";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag a standalone `Subject:` (new-mail draft, out of scope)", () => {
      // No "Re:" on the same line — this could be a legitimate new-mail
      // draft (out of scope for this MUST rule). The detector deliberately
      // does NOT fire here.
      const text = "Subject: Question about MAT223 PS3\n\nHi Prof. Tanaka,";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });

    it("does NOT flag the word 'Subject' inside prose", () => {
      const text =
        "The email's subject was about the interview, but the body had three slots.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });

    it("does NOT flag a quoted reply header that mentions the previous subject", () => {
      // Mid-body quoted-history headers are a normal email shape and
      // shouldn't trip the detector. The `件名:` MUST be at line-start
      // for the regex to fire — quoted blocks usually have a `>` prefix.
      const text = "Hi,\n\nThanks.\n\n> 件名: Re: 面接の件\n> from: ...";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });
  });

  // engineer-53 — ACTION_COMMITMENT_VIOLATION trailing variant detector.
  describe("trailing future action (ACTION_COMMITMENT_VIOLATION trailing)", () => {
    it("flags `メール本文を確認します` trailing a draft", () => {
      const text = [
        "下記のドラフトをご確認ください。",
        "",
        "[draft body]",
        "",
        "メール本文を確認して、必要な情報を拾います。",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("trailing future action");
    });

    it("flags `本文を確認します`", () => {
      const text = "了解しました。本文を確認します。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("flags `let me check the body` (English)", () => {
      const text = "Sure, let me check the body and get back to you.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("flags `reviewing the email` (English)", () => {
      const text = "Done — I'll send the draft after reviewing the email.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag past-tense `本文を確認しました`", () => {
      // Past tense = the agent already did the fetch; not a future-action
      // narration. Detector explicitly only matches the future form.
      const text = "本文を確認しました。下記のドラフトをご確認ください。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });

    it("does NOT flag `確認してください` (asking the user to check)", () => {
      // The user-directed verb form is the inverse: the agent is asking
      // the user to verify, not promising to fetch. Should not trip.
      const text = "下記のドラフトをご確認ください。";
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

  // engineer-53 — mode-specific corrective notes.
  it("appends a SUBJECT_LINE_FABRICATED_ON_REPLY note when the 件名 token matches", () => {
    const msg = buildPlaceholderLeakCorrection([
      "件名 fabricated on reply",
    ]);
    expect(msg).toContain("SUBJECT_LINE_FABRICATED_ON_REPLY");
    expect(msg.toLowerCase()).toContain("re:");
    expect(msg).toContain("body");
  });

  it("appends an ACTION_COMMITMENT_VIOLATION note when the trailing-action token matches", () => {
    const msg = buildPlaceholderLeakCorrection(["trailing future action"]);
    expect(msg).toContain("ACTION_COMMITMENT_VIOLATION");
    expect(msg.toLowerCase()).toContain("trailing");
  });

  it("does not append mode-specific notes when only generic tokens match", () => {
    const msg = buildPlaceholderLeakCorrection(["〇〇"]);
    expect(msg).not.toContain("SUBJECT_LINE_FABRICATED_ON_REPLY");
    expect(msg).not.toContain("ACTION_COMMITMENT_VIOLATION");
  });
});
