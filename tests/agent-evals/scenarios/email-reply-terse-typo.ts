// Scenario: real-world dogfood reproduction — terse user message + typo
// + write intent. Mirrors the 2026-05-13 dogfood failure that triggered
// engineer-53.
//
// Verbatim user message: 「令和とレベルとの次の面接日程へのメールを返したいです」
//
// Differences vs placeholder-leak-email-reply.ts:
// - User message has NO instructional hints (no "候補3つ", no "JST と PT
//   両方で見せて") — those biased the older scenario toward passing
//   because the model could just follow the recipe in the prompt.
// - Entity name is typo'd ("令和とレベル" vs "令和トラベル"), so the agent
//   must fuzzy-match AND disclose the correction (SILENT_AUTOCORRECT
//   coverage piggy-backed on top of the reply flow).
// - Reply intent + write context — the EMAIL REPLY WORKFLOW MUST-rules
//   in main.ts are the structural fix tested here.
//
// Failure modes touched: PLACEHOLDER_LEAK + METADATA_CONFUSED_FOR_CONTENT
// + TOOL_CHAIN_TRUNCATED + WRONG_TZ_DIRECTION + SUBJECT_LINE_FABRICATED_ON_REPLY
// + SILENT_AUTOCORRECT (the typo) + ACTION_COMMITMENT_VIOLATION (trailing).

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "email-reply-terse-typo",
  failureMode: "PLACEHOLDER_LEAK",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "畠山 竜都",
    },
    facts: [
      { fact: "Vancouverに住んでいる", category: "location" },
      { fact: "UToronto に2026年9月入学予定", category: "schedule" },
    ],
    inboxItems: [
      {
        id: "email-reiwa-typo",
        senderEmail: "recruiter@reiwa-travel.co.jp",
        senderName: "令和トラベル採用担当",
        subject: "次回面接のご連絡",
        snippet:
          "下記3候補からご都合の良い時間帯をお選びください。各60分程度を想定しております。",
        body: [
          "畠山様",
          "",
          "お世話になっております。令和トラベルの採用担当でございます。",
          "次回面接の候補として下記3つの日程をご提案いたします。",
          "各60分程度を想定しております。",
          "",
          "候補1: 2026年5月15日(金) 10:00-11:00 (JST)",
          "候補2: 2026年5月19日(火) 16:30-18:00 (JST)",
          "候補3: 2026年5月22日(金) 13:30-14:00 (JST)",
          "",
          "上記からご都合の良い時間帯をお選びいただき、ご返信いただけますと幸いです。",
          "",
          "何卒よろしくお願い申し上げます。",
          "令和トラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T01:30:00Z",
      },
    ],
    entities: [
      {
        id: "ent-reiwa-typo",
        kind: "org",
        displayName: "令和トラベル",
        aliases: ["Reiwa Travel"],
        description: "新卒採用面接プロセス中の旅行会社",
        primaryEmail: "recruiter@reiwa-travel.co.jp",
        linkedInboxItemIds: ["email-reiwa-typo"],
      },
    ],
  },
  input: {
    // Verbatim from the 2026-05-13 dogfood transcript. Do NOT edit
    // this string — it's the exact phrasing that surfaced the failure.
    userMessage:
      "令和とレベルとの次の面接日程へのメールを返したいです",
  },
  expect: [
    // (a) MUST chain — body fetch is non-negotiable
    { kind: "tool_called", name: "email_get_body" },
    // (b) MUST resolve sender TZ before citing slot times
    {
      kind: "custom",
      label: "sender TZ resolved (infer_sender_timezone OR convert_timezone fromTz=Asia/Tokyo)",
      check: (r) => {
        const inferCalled = r.toolCalls.some(
          (c) => c.name === "infer_sender_timezone"
        );
        const convertFromTokyo = r.toolCalls.some((c) => {
          if (c.name !== "convert_timezone") return false;
          const args = c.args as { fromTz?: string };
          return args.fromTz === "Asia/Tokyo";
        });
        return {
          pass: inferCalled || convertFromTokyo,
          message:
            inferCalled || convertFromTokyo
              ? undefined
              : "Neither infer_sender_timezone nor convert_timezone(fromTz=Asia/Tokyo) was called.",
        };
      },
    },
    // (c) MUST convert each candidate slot — at least 3 conversions for 3 slots
    { kind: "tool_called", name: "convert_timezone", minTimes: 3 },
    // (d) No 〇〇, no fabricated subject, no trailing-action narration
    { kind: "response_no_placeholder_leak" },
    { kind: "response_does_not_contain", text: "〇〇" },
    {
      kind: "custom",
      label: "no fabricated 件名: Re: line in the draft body",
      check: (r) => {
        const pass = !/^\s*(件名|Subject)\s*[:：]\s*Re:/im.test(r.finalText);
        return {
          pass,
          message: pass
            ? undefined
            : "Draft body contains a fabricated `件名: Re:` / `Subject: Re:` line — Gmail auto-prefixes Re: on a reply.",
        };
      },
    },
    // (e) Sender's TZ must appear so the user can verify the anchor.
    // Accept any of: JST abbreviation, Asia/Tokyo IANA name, or 東京.
    // The mini model's `convert_timezone` result varies on which form
    // it surfaces — all three are equally informative to the user.
    {
      kind: "response_matches",
      regex: /(JST|Asia\/Tokyo|東京)/i,
    },
    // (f) User-side TZ on first mention (PT/PDT/PST acceptable)
    { kind: "response_matches", regex: /\bP(D|S)?T\b/ },
    // (g) At least 3 concrete date/time tokens — proof the slots were echoed
    {
      kind: "custom",
      label: "response cites at least 3 concrete date/time tokens",
      check: (r) => {
        const t = r.finalText;
        const digitGroups = (t.match(/\d{1,2}[:月時]/g) ?? []).length;
        return {
          pass: digitGroups >= 3,
          message:
            digitGroups >= 3
              ? undefined
              : `Expected ≥3 concrete date/time tokens for the 3 candidate slots; got ${digitGroups}.`,
        };
      },
    },
    // (h) SILENT_AUTOCORRECT mitigation. The canonical entity name
    // MUST appear in the response (so the user sees which company /
    // person Steadii is acting on). Explicit typo-disclosure
    // ("令和とレベル」だと該当なし、『令和トラベル』のことですね") is
    // ideal but mini-model variance makes a strict assertion flaky on
    // this WRITE-intent scenario — the sibling READ-intent scenario
    // `silent-autocorrect-disclosure.ts` keeps the strict version, so
    // the SILENT_AUTOCORRECT regression remains gated. Here we only
    // require the canonical name to appear.
    { kind: "response_contains", text: "令和トラベル" },
    // (i) Sign-off / placeholder gating. The fixture has a typo so the
    // FUZZY MATCH ON ZERO HITS rule says "ASK before acting" on WRITE
    // intent — meaning the model may legitimately respond with the
    // disclosure + slot list + a clarification question and skip the
    // draft entirely. That's correct behavior, NOT a failure.
    //
    // The assertion is therefore conditional: if the response contains
    // a draft body with a sign-off, the sign-off MUST use the user's
    // real name (not 〇〇 / {name} / "Your Name"). If no draft is
    // present (clarification-only flow), the assertion passes — the
    // placeholder-leak detector already catches any 〇〇 emitted in
    // the clarification turn itself.
    {
      kind: "custom",
      label:
        "sign-off uses the user's real name when a draft is emitted (no 〇〇 / {name} placeholder)",
      check: (r) => {
        const t = r.finalText;
        const hasPlaceholder = /〇〇|○○|◯◯|\{(name|名前|署名)\}/.test(t);
        if (hasPlaceholder) {
          return {
            pass: false,
            message:
              "Response contains a placeholder (〇〇 / {name} / etc.) — even in a clarification-only turn this is wrong.",
          };
        }
        // Heuristic for "draft was emitted": the body contains both a
        // greeting (お世話になっております / 畠山様 / Hi 〜) AND a
        // closing (よろしくお願い / Best / Sincerely). When neither
        // marker is present we assume the model chose the clarification
        // branch — that's correct WRITE-intent behavior on a typo'd
        // entity reference, no sign-off required.
        const hasDraftBody =
          (t.includes("お世話になっております") ||
            t.includes("お疲れ様") ||
            /Hi\s+\S/.test(t)) &&
          (t.includes("よろしくお願い") ||
            t.includes("Best,") ||
            t.includes("Sincerely") ||
            t.includes("Regards"));
        if (!hasDraftBody) return { pass: true };
        const hasRealName =
          t.includes("畠山") || t.includes("竜都") || t.includes("Ryuto");
        return {
          pass: hasRealName,
          message: hasRealName
            ? undefined
            : "A draft body was emitted but the sign-off did not include the user's real name (畠山 / 竜都 / Ryuto).",
        };
      },
    },
    // (j) ACTION_COMMITMENT_VIOLATION trailing — must NOT promise a
    // future fetch after the draft.
    {
      kind: "custom",
      label: "no trailing future-action narration after the draft",
      check: (r) => {
        const pass = !/(メール本文を確認します|本文を確認します|確認して報告します|let me check the body)/i.test(
          r.finalText
        );
        return {
          pass,
          message: pass
            ? undefined
            : "Response trails a future-action phrase (`メール本文を確認します` etc.) after the draft. The fetch should happen BEFORE drafting, not as a postscript.",
        };
      },
    },
  ],
};

export default scenario;
