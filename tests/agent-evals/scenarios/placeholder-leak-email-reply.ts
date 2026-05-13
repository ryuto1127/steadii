// Scenario: PLACEHOLDER_LEAK on the 令和トラベル email-reply flow.
//
// Origin: 2026-05-12 dogfood. Agent emitted a template containing
// 〇〇 / "ご提示いただいた日程で参加可能です" / undated slots and shipped
// it as a draft. Root cause was stopping after lookup_entity (metadata
// only) and writing Mad Libs prose instead of fetching email_get_body
// for the actual slot list. Fix shipped in PR #229 (OUTPUT GROUNDING)
// and PR #230 (self-critique pass).
//
// This scenario regression-tests both layers: the prompt should drive
// the right tool chain, and the self-critique pass should catch any
// leak the model still emits.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "placeholder-leak-email-reply",
  failureMode: "PLACEHOLDER_LEAK",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    facts: [
      { fact: "Vancouverに住んでいる", category: "location" },
      { fact: "UToronto に2026年9月入学予定", category: "schedule" },
    ],
    inboxItems: [
      {
        id: "email-reiwa",
        senderEmail: "recruiter@reiwa-travel.co.jp",
        senderName: "令和トラベル採用担当",
        subject: "次回面接のご連絡",
        snippet:
          "下記3候補からご都合の良い時間帯をお選びください。各60分程度を想定しております。",
        body: [
          "Ryuto様",
          "",
          "お世話になっております。令和トラベルの採用担当でございます。",
          "次回面接の候補として下記3つの日程をご提案いたします。",
          "各60分程度を想定しております。",
          "",
          "候補1: 2026年5月15日(木) 10:00-11:00 (JST)",
          "候補2: 2026年5月15日(木) 14:00-15:00 (JST)",
          "候補3: 2026年5月16日(金) 10:00-11:00 (JST)",
          "",
          "上記からご都合の良い時間帯をお選びいただき、ご返信いただけますと幸いです。",
          "",
          "何卒よろしくお願い申し上げます。",
          "令和トラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-12T01:30:00Z",
      },
    ],
    entities: [
      {
        id: "ent-reiwa",
        kind: "org",
        displayName: "令和トラベル",
        aliases: ["Reiwa Travel"],
        description: "新卒採用面接プロセス中の旅行会社",
        primaryEmail: "recruiter@reiwa-travel.co.jp",
        linkedInboxItemIds: ["email-reiwa"],
      },
    ],
  },
  input: {
    userMessage:
      "令和トラベルとの面接日程に返信したい。候補3つそれぞれを JST と PT 両方で見せて。",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    // The agent may infer the sender TZ via the dedicated tool OR
    // directly via convert_timezone with fromTz=Asia/Tokyo. Either path
    // counts — what matters is that the TZ ANCHOR is correct (it's the
    // sender's TZ, not the user's).
    {
      kind: "custom",
      label: "sender TZ resolved to Asia/Tokyo (via infer or convert)",
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
              : "Neither infer_sender_timezone nor a convert_timezone(fromTz=Asia/Tokyo) call was observed.",
        };
      },
    },
    {
      kind: "tool_called",
      name: "convert_timezone",
      minTimes: 3,
    },
    { kind: "response_no_placeholder_leak" },
    { kind: "response_contains", text: "JST" },
    // Accept PT, PDT, or PST — all are valid Pacific TZ abbreviations.
    // The dogfood failure mode was the COMPLETE ABSENCE of any user-TZ
    // annotation, not the specific abbreviation form.
    { kind: "response_matches", regex: /\bP(D|S)?T\b/ },
    // The dogfood signature for this failure mode is a slot list with
    // no concrete date/time digits — every candidate must contain at
    // least one digit (real date or time), otherwise the agent emitted
    // a template.
    {
      kind: "custom",
      label: "response contains concrete slot times (not template prose)",
      check: (r) => {
        const t = r.finalText;
        const digitGroups = (t.match(/\d{1,2}[:月時]/g) ?? []).length;
        return {
          pass: digitGroups >= 3,
          message:
            digitGroups >= 3
              ? undefined
              : `Expected at least 3 concrete date/time tokens for the 3 candidate slots; got ${digitGroups}.`,
        };
      },
    },
    { kind: "response_does_not_contain", text: "〇〇" },
    {
      kind: "response_does_not_contain",
      text: "ご提示いただいた日程",
    },
  ],
};

export default scenario;
