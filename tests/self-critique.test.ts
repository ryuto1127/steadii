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
      // 2026-05-19 — wrapped the draft body in a fenced code block per
      // MUST-rule 10 (the post-#281 DRAFT_OUTSIDE_CODE_BLOCK detector
      // correctly flags raw inline draft prose, which is exactly the
      // production failure shape we now gate against).
      const text = `サンプル株式会社からの面接日程について、第一〜第三希望を整理して返信案を作りました。

\`\`\`text
お世話になっております。田中 太郎です。
ご連絡ありがとうございます。

下記の通り、希望日程をお送りいたします。
第一希望：5月15日(金) 11:30〜12:00 JST (バンクーバー: 5月14日(木) 19:30〜20:00 PT)
第二希望：5月19日(火) 16:30〜17:00 JST (バンクーバー: 5月19日(火) 00:30〜01:00 PT)
第三希望：5月22日(金) 13:30〜14:00 JST (バンクーバー: 5月21日(木) 21:30〜22:00 PT)

何卒よろしくお願いいたします。
\`\`\``;
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
        "アクメトラベル",
        "田中 太郎です。",
      ].join("\n");
      const r = detectPlaceholderLeak(text);
      expect(r.hasLeak).toBe(true);
      expect(r.matched).toContain("件名 fabricated on reply");
    });

    it("flags `Subject: Re: ...` (English)", () => {
      const text = [
        "Subject: Re: Interview slots",
        "",
        "Hi Acme Travel,",
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
        "Hi Acme Travel,\nThanks — the proposed slot at 18:00 works for me.\nBest, Alex";
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
        "田中 太郎",
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
        userMessage: "アクメトラベルから返信が来てるから返信したい",
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
        userMessage: "アクメトラベルから返信が来てるから返信したい",
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
        userMessage: "アクメトラベルから返信が来てるから返信したい",
      });
      expect(r.matched).not.toContain(
        "reply intent without email_get_new_content_only"
      );
    });

    it("fires on English reply triggers too", () => {
      const r = detectPlaceholderLeak(replyDraft, {
        toolCallHistory: [{ toolName: "email_get_body" }],
        userMessage: "Draft a reply to Acme Travel",
      });
      expect(r.matched).toContain(
        "reply intent without email_get_new_content_only"
      );
    });
  });
});

// 2026-05-19 — three structural-violation detectors mirroring the
// production dogfood failure shape: missing intro, draft outside code
// block, counter window with only one TZ.

describe("detectMissingIntroBeforeDraft", () => {
  const draftBlock =
    "```text\nお世話になっております。\nご連絡ありがとうございます。\nよろしくお願いいたします。\n田中 太郎\n```";

  it("does NOT flag a response with a substantive intro before the draft", () => {
    const text =
      `サンプルコンサルからの面接日程返信案です。候補は 5/22 13:30 JST / 5/21 21:30 PDT で、対応時間ぎりぎりなのでもう少し早い時間でお願いする内容にしました。\n\n${draftBlock}`;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("missing intro before draft");
  });

  it("flags a response that opens directly with the code block (no intro)", () => {
    const text = `${draftBlock}\n\nもっと短くしますか?`;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("missing intro before draft");
  });

  it("flags an intro shorter than 40 chars", () => {
    const text = `返信案です。\n\n${draftBlock}`;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("missing intro before draft");
  });

  it("flags an intro with no sentence-ending punctuation", () => {
    const text =
      "返信案を作成中、もう少しお待ちください、こちらで進めます、ありがとうございます\n\n" +
      draftBlock;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("missing intro before draft");
  });

  it("does NOT flag a response with no draft code block (no MUST-rule 11 obligation)", () => {
    const text = "今週は授業が3つ、課題が2つあります。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("missing intro before draft");
  });

  it("does NOT flag a code block that isn't a draft (no greeting+closing)", () => {
    const text = "config snippet:\n```yaml\nport: 3000\n```";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("missing intro before draft");
  });
});

describe("detectDraftOutsideCodeBlock", () => {
  it("flags a draft body emitted as plain text (no fence)", () => {
    const text =
      "サンプルコンサルへの返信案を作りました。\n\nお世話になっております。\nご連絡ありがとうございます。\n5/22 13:30 でご調整いただけますと幸いです。\nよろしくお願いいたします。\n田中 太郎";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("draft body outside code block");
  });

  it("does NOT flag a draft properly wrapped in a fenced code block", () => {
    const text =
      "サンプルコンサルへの返信案を作りました。\n\n```text\nお世話になっております。\nご連絡ありがとうございます。\nよろしくお願いいたします。\n田中 太郎\n```\n\nもっと短くしますか?";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("draft body outside code block");
  });

  it("does NOT flag a response with neither greeting nor closing", () => {
    const text = "今週の予定はカレンダーで確認できます。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("draft body outside code block");
  });

  it("does NOT flag a response with greeting but no closing", () => {
    const text =
      "お世話になっております、確認しました。詳細はこちらです。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("draft body outside code block");
  });
});

describe("detectCounterWindowNotDualTZ", () => {
  it("flags counter language with HH:MM range in user-TZ only", () => {
    const text =
      "ご提案いただいた候補は対応時間外のため、もう少し早い時間でお願いできますでしょうか。平日であれば、13:00〜21:00（バンクーバー時間）で調整可能です。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("counter window not dual-TZ");
  });

  it("flags counter language with HH:MM range in sender-TZ (JST) only", () => {
    const text =
      "ご提示いただいた候補は対応が難しく、別の時間でご調整いただけますでしょうか。9:00〜15:00 JST 帯ですと調整しやすいです。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("counter window not dual-TZ");
  });

  it("does NOT flag a counter window with both TZ ranges side-by-side", () => {
    const text =
      "別の時間でご調整いただけますでしょうか。9:00〜15:00 JST (バンクーバー時間で 17:00〜23:00 PDT) であれば調整しやすいです。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window not dual-TZ");
  });

  it("does NOT flag a response with no counter-push language (even if single-TZ ranges appear)", () => {
    const text =
      "今週の予定は 13:00〜14:00 です。MAT223 の講義があります。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window not dual-TZ");
  });

  it("does NOT flag counter language without any HH:MM range (different failure path)", () => {
    const text =
      "ご提示いただいた候補は対応が難しく、もう少し早い時間でご調整いただけますでしょうか。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window not dual-TZ");
  });
});

// 2026-05-19 — COUNTER_WINDOW_VAGUE detector. Counter-push language
// fires but no concrete HH:MM in the counter scope. Catches the post-#282
// production dogfood shape ("平日の日中〜夕方で再度ご調整いただけますと幸いです").

describe("detectCounterWindowVague", () => {
  it("flags counter language with no HH:MM in the 300-char scope", () => {
    const text =
      "もし可能でしたら、平日の日中〜夕方で再度ご調整いただけますと幸いです。お手数をおかけしますが、何卒よろしくお願いいたします。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("counter window vague");
  });

  it("does NOT flag a counter window with a concrete HH:MM range nearby", () => {
    const text =
      "もし可能でしたら、JST 9:00–13:00 (バンクーバー時間 17:00–21:00) であれば調整しやすく、再度ご調整いただけますと幸いです。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window vague");
  });

  it("does NOT flag when counter scope contains ≥2 distinct HH:MM tokens (multi-slot proposal)", () => {
    const text =
      "もう少し早い時間で、5/22 14:00 か 5/23 10:00 でいかがでしょうか。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window vague");
  });

  it("does NOT flag when no counter-push language is present (different failure path)", () => {
    const text = "今週の予定は朝の会議が3つ、午後の課題が2つあります。";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("counter window vague");
  });

  it("flags even when an HH:MM range exists far away (e.g., in the intro discussing the original slots)", () => {
    // The intro mentions the SENDER's slots in dual-TZ form, then the
    // draft body has a vague counter. The detector scopes to the
    // counter-push position, so an HH:MM range in the intro doesn't
    // satisfy the check.
    const text =
      "候補は 5/20(水) 18:00–18:45 JST / 5/20(水) 02:00–02:45 PDT と、5/21(木) 15:00–15:45 JST / 5/20(水) 23:00–23:45 PDT で、どちらもこちらの時間ではかなり遅いです。\n\n```text\nお世話になっております。\n\nもし可能でしたら、平日の日中〜夕方で再度ご調整いただけますと幸いです。\n\n何卒よろしくお願いいたします。\n田中 太郎\n```";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("counter window vague");
  });
});

// 2026-05-19 — ROLE_FLIPPED_GREETING detector. Catches the post-#291
// dogfood failure where the agent put the user's own name at the top
// of the draft AND in the sign-off — so the email reads as addressed
// to the user themselves.

describe("detectRoleFlippedGreeting", () => {
  it("flags a draft whose greeting and sign-off are the same name", () => {
    const text = `返信案を作りました。

\`\`\`text
田中 太郎 さま

お世話になっております。
ご調整ありがとうございます。
よろしくお願いいたします。

田中 太郎
\`\`\``;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("role-flipped greeting");
  });

  it("does NOT flag a draft addressed to a different recipient", () => {
    const text = `返信案を作りました。

\`\`\`text
アクメトラベル 採用担当者さま

お世話になっております。
ご調整ありがとうございます。
よろしくお願いいたします。

田中 太郎
\`\`\``;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("role-flipped greeting");
  });

  it("does NOT flag a team-level greeting with no name", () => {
    const text = `返信案を作りました。

\`\`\`text
ご担当者さま

お世話になっております。
ご調整ありがとうございます。
よろしくお願いいたします。

田中 太郎
\`\`\``;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("role-flipped greeting");
  });

  it("does NOT false-positive on partial family-name overlap", () => {
    const text = `返信案を作りました。

\`\`\`text
田中 一郎 さま

お世話になっております。
ご調整ありがとうございます。
よろしくお願いいたします。

田中 太郎
\`\`\``;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("role-flipped greeting");
  });

  it("flags the EN shape — Dear <user> + sign-off <user>", () => {
    const text = `Drafted reply:

\`\`\`text
Dear Taro Tanaka,

Thanks for reaching out.
Best regards,

Taro Tanaka
\`\`\``;
    const r = detectPlaceholderLeak(text);
    expect(r.matched).toContain("role-flipped greeting");
  });

  it("does NOT flag a response without a draft code block", () => {
    const text = "Just a plain status response: you have 3 tasks today.";
    const r = detectPlaceholderLeak(text);
    expect(r.matched).not.toContain("role-flipped greeting");
  });
});

// 2026-05-19 — slot-list-without-convert_timezone detector loosened
// from ≥3 to ≥2. Verify the new threshold catches the 2-slot dogfood
// shape that previously slipped through.

describe("slot list without convert_timezone — loosened threshold (≥2)", () => {
  it("flags a 2-slot dual-TZ list when convert_timezone was never called", () => {
    const text = `候補は
- 5/20(水) 18:00 JST / 5/20(水) 02:00 PDT
- 5/21(木) 15:00 JST / 5/21(木) 07:00 PDT
です。`;
    const r = detectPlaceholderLeak(text, {
      toolCallHistory: [
        { toolName: "email_get_body" },
        { toolName: "infer_sender_timezone" },
      ],
      userMessage: "アクメトラベルへの返信",
    });
    expect(r.matched).toContain("slot list without convert_timezone");
  });

  it("does NOT flag when convert_timezone WAS called even with 2 slots", () => {
    const text = `候補は
- 5/20(水) 18:00 JST / 5/20(水) 02:00 PDT
- 5/21(木) 15:00 JST / 5/20(水) 23:00 PDT
です。`;
    const r = detectPlaceholderLeak(text, {
      toolCallHistory: [
        { toolName: "email_get_body" },
        { toolName: "convert_timezone" },
        { toolName: "convert_timezone" },
      ],
      userMessage: "アクメトラベルへの返信",
    });
    expect(r.matched).not.toContain("slot list without convert_timezone");
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

  // 2026-05-19 — corrective notes for the structural-violation detectors.
  it("appends a MISSING_INTRO_BEFORE_DRAFT note when the missing-intro token matches", () => {
    const msg = buildPlaceholderLeakCorrection(["missing intro before draft"]);
    expect(msg).toContain("MISSING_INTRO_BEFORE_DRAFT");
    expect(msg).toContain("MUST-rule 11");
    expect(msg.toLowerCase()).toContain("intro");
  });

  it("appends a DRAFT_OUTSIDE_CODE_BLOCK note when the outside-fence token matches", () => {
    const msg = buildPlaceholderLeakCorrection(["draft body outside code block"]);
    expect(msg).toContain("DRAFT_OUTSIDE_CODE_BLOCK");
    expect(msg).toContain("MUST-rule 10");
    expect(msg.toLowerCase()).toContain("fenced");
  });

  it("appends a COUNTER_WINDOW_NOT_DUAL_TZ note when the counter-single-TZ token matches", () => {
    const msg = buildPlaceholderLeakCorrection(["counter window not dual-TZ"]);
    expect(msg).toContain("COUNTER_WINDOW_NOT_DUAL_TZ");
    expect(msg).toContain("COUNTER-PROPOSAL PATTERN");
    expect(msg.toLowerCase()).toContain("convert_timezone");
  });

  // 2026-05-19 — corrective note for the new vague-counter detector.
  it("appends a COUNTER_WINDOW_VAGUE note when the counter-vague token matches", () => {
    const msg = buildPlaceholderLeakCorrection(["counter window vague"]);
    expect(msg).toContain("COUNTER_WINDOW_VAGUE");
    expect(msg).toContain("COUNTER-PROPOSAL PATTERN");
    expect(msg).toContain("infer_sender_norms");
    expect(msg.toLowerCase()).toContain("vague");
  });

  // 2026-05-19 — ROLE_FLIPPED_GREETING corrective note.
  it("appends a ROLE_FLIPPED_GREETING note when the matched token fires", () => {
    const msg = buildPlaceholderLeakCorrection(["role-flipped greeting"]);
    expect(msg).toContain("ROLE_FLIPPED_GREETING");
    expect(msg).toContain("MUST-rule 5b");
    expect(msg).toContain("sign-off");
    expect(msg.toLowerCase()).toContain("recipient");
  });
});
