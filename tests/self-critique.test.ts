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

    it("does NOT flag valid times like 10:00 (with dual-TZ alongside)", () => {
      // 2026-05-13 engineer-54 — engineer-54 added a JST-without-user-
      // local-TZ proximity check (WORKING_HOURS_IGNORED detector), so
      // a slot shown JST-only would legitimately fire that detector.
      // The original purpose of this case was to verify "10:00 isn't a
      // placeholder shape" — adding the PT counterpart preserves that
      // assertion without colliding with the new MUST-rule 7 detector.
      const r = detectPlaceholderLeak(
        "10:00–11:00 JST / 18:00–19:00 PT が候補です"
      );
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

  // 2026-05-14 — CONTEXT_LABEL_LEAK detector. The user-context block
  // uses ALL_CAPS_WITH_UNDERSCORES labels (USER_WORKING_HOURS, USER_NAME,
  // USER_FACTS, USER_TIMEZONE) as reasoning scaffolding. Quoting them
  // verbatim in user-facing prose reveals internals — caught the first
  // time post-engineer-54 when the agent literally said
  // `USER_WORKING_HOURS が未設定なので…` to Ryuto.
  describe("context label leak (CONTEXT_LABEL_LEAK)", () => {
    it("flags USER_WORKING_HOURS in JA prose", () => {
      const text =
        "USER_WORKING_HOURS が未設定なので、まず対応しやすい時間帯を1回だけ教えてください。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("context label leak");
    });

    it("flags USER_NAME in EN prose", () => {
      const text = "Hi USER_NAME, hope your week is going well.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("flags USER_FACTS reference", () => {
      const text = "I'll save this to USER_FACTS for next time.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("flags USER_TIMEZONE reference", () => {
      const text =
        "ご提案の時刻は USER_TIMEZONE では夜遅くにあたります。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag natural-language phrasing of the same concept", () => {
      // The fix tells the agent to translate USER_WORKING_HOURS to
      // 「対応可能時間帯」 / "meeting hours". This text uses both
      // natural forms and must NOT trip.
      const text =
        "対応可能時間帯がまだ分からないので、教えていただけると助かります。Your meeting hours aren't set yet.";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(false);
    });
  });

  // engineer-54 — LATE_NIGHT_SLOT_ACCEPTED_BLINDLY heuristic. Catches
  // drafts that accept a proposed slot without disclosing the user-
  // local time. False-positive-tolerant on purpose; the retry pass
  // gives the agent a clean second swing with SLOT FEASIBILITY CHECK
  // in scope.
  describe("slot acceptance missing user-local TZ (LATE_NIGHT_SLOT_ACCEPTED_BLINDLY)", () => {
    it("flags `ご提示いただいた日程で参加可能です` without user-local TZ", () => {
      const text =
        "お世話になっております。\nご提示いただいた日程で参加可能です。\n何卒よろしくお願いいたします。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("slot acceptance missing user-local TZ");
    });

    it("flags `the proposed slot ... works for me` (English)", () => {
      const text =
        "Hi Reiwa Travel,\nThanks — the proposed slot at 18:00 works for me.\nBest, Ryuto";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("slot acceptance missing user-local TZ");
    });

    it("flags `ご提案いただいた日時で問題ありません`", () => {
      const text = "ご提案いただいた日時で問題ありません。";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
    });

    it("does NOT flag a polite counter-proposal that explicitly pushes back", () => {
      // A push-back uses 「難しい」/「対応できかねます」, not 「参加可能」.
      // The detector should not fire on negation language.
      const text =
        "お世話になっております。\nご提案いただいた日程ですが、5/20 18:00 JST はバンクーバー時刻で 02:00 となり、夜間のためご対応が難しいです。代わりに JST の 9:00–14:00 帯であれば調整しやすく、別日程をご提示いただけますと幸いです。";
      const r = detectPlaceholderLeak(text);
      // PT is mentioned (バンクーバー時刻), so working-hours detector also OK.
      expect(r.matched).not.toContain(
        "slot acceptance missing user-local TZ"
      );
    });
  });

  // engineer-54 — WORKING_HOURS_IGNORED proximity check. JST mentioned
  // without PT/PDT/PST within 80 chars = MUST-rule 7 violation.
  describe("JST without user-local TZ nearby (WORKING_HOURS_IGNORED / MUST-rule 7)", () => {
    it("flags a slot list shown only in JST", () => {
      const text =
        "候補1: 5月15日(金) 10:00 JST\n候補2: 5月19日(火) 16:30 JST\n候補3: 5月22日(金) 13:30 JST";
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("JST without user-local TZ nearby");
    });

    it("does NOT flag a slot list with PT alongside each JST mention", () => {
      const text = [
        "候補1: 5月15日(金) 10:00 JST / 5月14日(木) 18:00 PT",
        "候補2: 5月19日(火) 16:30 JST / 5月19日(火) 00:30 PDT",
        "候補3: 5月22日(金) 13:30 JST / 5月21日(木) 21:30 PT",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.matched).not.toContain("JST without user-local TZ nearby");
    });

    it("does NOT flag a single JST + バンクーバー時刻 within window", () => {
      const text =
        "5/20 18:00 JST はバンクーバー時刻で 02:00 となり、夜間のためご対応が難しいです。";
      const r = detectPlaceholderLeak(text);
      expect(r.matched).not.toContain("JST without user-local TZ nearby");
    });

    it("flags JST when the PT mention is far away (>80 chars)", () => {
      // The PT mention is at the end, well outside the 80-char window.
      const lorem = "x".repeat(200);
      const text = `5/20 18:00 JST です。${lorem}（参考: PT は -16h）`;
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("JST without user-local TZ nearby");
    });

    it("does NOT flag non-JST responses", () => {
      const text =
        "Tomorrow you have CS 348 at 10:00 and Office Hours with Prof. Tanaka at 14:00.";
      const r = detectPlaceholderLeak(text);
      expect(r.matched).not.toContain("JST without user-local TZ nearby");
    });

    it("does NOT flag 日本時間 when PT is nearby", () => {
      // 日本時間 is an alias of JST that should fire the same logic; PT in
      // the same sentence keeps it clean.
      const text =
        "日本時間 5月15日 10:00 / バンクーバー時刻 5月14日 18:00 PT が候補です";
      const r = detectPlaceholderLeak(text);
      expect(r.matched).not.toContain("JST without user-local TZ nearby");
    });

    // 2026-05-13 refinement — the detector now accepts the "analysis in
    // user-TZ + draft body in sender-TZ" shape. The draft body addressed
    // to a JST recipient legitimately uses JST-only inside the fence;
    // the analysis prose above establishes PT context for the user.
    it("does NOT flag JST in a draft body when PT context was established earlier", () => {
      const text = [
        "候補1 は 5月14日(木) 19:30 PDT、候補2 は 5月16日(土) 02:00 PDT です。",
        "勤務可能時間が 08:00–22:00 なので、候補2 は深夜帯で外れます。",
        "",
        "```text",
        "お世話になっております。",
        "候補1の2026年5月15日(金) 11:30-12:15 (JST)でお願いいたします。",
        "畠山 竜都",
        "```",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.matched).not.toContain("JST without user-local TZ nearby");
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

  // engineer-62 — cascade-failure detectors. Fire only when the caller
  // hands the detector tool-call history (and, for the reply-intent
  // detector, the user message text).
  describe("slot list without convert_timezone (THREAD_ROLE_CASCADE)", () => {
    const dualTzSlotList = [
      "候補1: 5月15日(金) 10:00 JST / 5月14日(木) 18:00 PT",
      "候補2: 5月19日(火) 16:30 JST / 5月19日(火) 00:30 PDT",
      "候補3: 5月22日(金) 13:30 JST / 5月21日(木) 21:30 PT",
    ].join("\n");

    it("flags ≥3 slot lines when convert_timezone was NEVER called", () => {
      const r = detectPlaceholderLeak(dualTzSlotList, {
        toolCallHistory: [
          { toolName: "email_search" },
          { toolName: "email_get_body" },
        ],
      });
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("slot list without convert_timezone");
    });

    it("does NOT flag when convert_timezone WAS called", () => {
      const r = detectPlaceholderLeak(dualTzSlotList, {
        toolCallHistory: [
          { toolName: "email_get_body" },
          { toolName: "convert_timezone" },
          { toolName: "convert_timezone" },
        ],
      });
      expect(r.matched).not.toContain("slot list without convert_timezone");
    });

    it("does NOT flag when no tool-call history is provided", () => {
      // Detector is a no-op when context is absent — preserves legacy
      // text-only callers (e.g. older unit tests).
      const r = detectPlaceholderLeak(dualTzSlotList);
      expect(r.matched).not.toContain("slot list without convert_timezone");
    });

    it("does NOT flag a single-time-reference response", () => {
      // One time mention isn't a slot list — the floor is 3 lines that
      // each contain a date, a time, AND a TZ marker.
      const text =
        "明日 10:00 のミーティングを確認しました。資料は事前に共有します。";
      const r = detectPlaceholderLeak(text, {
        toolCallHistory: [{ toolName: "calendar_list_events" }],
      });
      expect(r.matched).not.toContain("slot list without convert_timezone");
    });

    it("does NOT flag a calendar-listing response that lives entirely in user's TZ (no TZ markers per line)", () => {
      // happy-path-week-summary shape — three calendar events shown in
      // the user's own TZ, no conversion needed. Pre-2026-05-14 the
      // detector tripped here because it only checked date+time. Now
      // requires a TZ marker per slot line.
      const text = [
        "今週はこんな感じです。",
        "",
        "- 5/13(火) 15:30–16:50: MAT223 Lecture",
        "- 5/14(水) 10:00–11:00: CSC110 Tutorial",
        "- 5/15(木) 13:00–14:30: ENG140 Essay Workshop",
      ].join("\n");
      const r = detectPlaceholderLeak(text, {
        toolCallHistory: [{ toolName: "calendar_list_events" }],
      });
      expect(r.matched).not.toContain("slot list without convert_timezone");
    });
  });

  describe("reply intent without email_get_new_content_only (THREAD_ROLE_CONFUSED risk)", () => {
    const replyDraft = [
      "下記の通り、希望日程をお送りします。",
      "候補1: 5月20日(水) 18:00 JST / 5月20日(水) 02:00 PDT",
    ].join("\n");

    it("flags reply intent + email_get_body called + email_get_new_content_only NOT called", () => {
      const r = detectPlaceholderLeak(replyDraft, {
        toolCallHistory: [
          { toolName: "email_search" },
          { toolName: "email_get_body" },
          { toolName: "convert_timezone" },
        ],
        userMessage: "令和トラベルから返信が来てるから返信したい",
      });
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain(
        "reply intent without email_get_new_content_only"
      );
    });

    it("does NOT flag when email_get_new_content_only WAS called", () => {
      const r = detectPlaceholderLeak(replyDraft, {
        toolCallHistory: [
          { toolName: "email_get_body" },
          { toolName: "email_get_new_content_only" },
          { toolName: "convert_timezone" },
        ],
        userMessage: "令和トラベルから返信が来てるから返信したい",
      });
      expect(r.matched).not.toContain(
        "reply intent without email_get_new_content_only"
      );
    });

    it("does NOT flag when user intent is NOT a reply (e.g. status question)", () => {
      const r = detectPlaceholderLeak(replyDraft, {
        toolCallHistory: [{ toolName: "email_get_body" }],
        userMessage: "あのメールに5/20の時間って書いてあった？",
      });
      expect(r.matched).not.toContain(
        "reply intent without email_get_new_content_only"
      );
    });

    it("does NOT flag when response contains no slot dates", () => {
      const text =
        "承知しました。ドラフトはまだ作成していません — 候補日程をご教示ください。";
      const r = detectPlaceholderLeak(text, {
        toolCallHistory: [{ toolName: "email_get_body" }],
        userMessage: "令和トラベルから返信が来てるから返信したい",
      });
      expect(r.matched).not.toContain(
        "reply intent without email_get_new_content_only"
      );
    });

    it("fires on English reply triggers too", () => {
      const r = detectPlaceholderLeak(replyDraft, {
        toolCallHistory: [{ toolName: "email_get_body" }],
        userMessage: "Draft a reply to Reiwa Travel",
      });
      expect(r.matched).toContain(
        "reply intent without email_get_new_content_only"
      );
    });
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
    expect(msg).not.toContain("LATE_NIGHT_SLOT_ACCEPTED_BLINDLY");
    expect(msg).not.toContain("WORKING_HOURS_IGNORED");
  });

  // engineer-54 — mode-specific corrective notes for push-back failures.
  it("appends a LATE_NIGHT_SLOT_ACCEPTED_BLINDLY note when the slot-acceptance token matches", () => {
    const msg = buildPlaceholderLeakCorrection([
      "slot acceptance missing user-local TZ",
    ]);
    expect(msg).toContain("LATE_NIGHT_SLOT_ACCEPTED_BLINDLY");
    expect(msg).toContain("SLOT FEASIBILITY CHECK");
    expect(msg).toContain("USER_WORKING_HOURS");
  });

  it("appends a WORKING_HOURS_IGNORED note when the JST-without-PT token matches", () => {
    const msg = buildPlaceholderLeakCorrection([
      "JST without user-local TZ nearby",
    ]);
    expect(msg).toContain("WORKING_HOURS_IGNORED");
    expect(msg).toContain("MUST-rule 7");
    expect(msg.toLowerCase()).toContain("convert_timezone");
  });

  // engineer-62 — cascade-failure corrective notes.
  it("appends a THREAD_ROLE_CASCADE note when the slot-list-no-convert_timezone token matches", () => {
    const msg = buildPlaceholderLeakCorrection([
      "slot list without convert_timezone",
    ]);
    expect(msg).toContain("THREAD_ROLE_CASCADE");
    expect(msg.toLowerCase()).toContain("convert_timezone");
    expect(msg).toContain("email_get_new_content_only");
  });

  it("appends a THREAD_ROLE_CONFUSED note when the reply-intent-no-new-content token matches", () => {
    const msg = buildPlaceholderLeakCorrection([
      "reply intent without email_get_new_content_only",
    ]);
    expect(msg).toContain("THREAD_ROLE_CONFUSED");
    expect(msg).toContain("email_get_new_content_only");
    expect(msg).toContain("email_get_body");
  });
});
