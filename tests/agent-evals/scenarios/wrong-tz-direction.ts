// Scenario: WRONG_TZ_DIRECTION.
//
// Origin: 2026-05-12 dogfood. Agent inverted the conversion (treated
// email times as user's local TZ and converted to JST). Fix in PR #226:
// strengthened prompt rule "conversion direction: fromTz=sender,
// toTz=user, NEVER reversed", plus body-language signal in the
// sender-tz heuristic so JP-language emails from generic domains still
// resolve to Asia/Tokyo.
//
// This scenario uses a generic .com sender with a Japanese body — the
// only way to land on Asia/Tokyo is to call infer_sender_timezone with
// the body, so we assert both the tool call AND the conversion
// direction.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "wrong-tz-direction",
  failureMode: "WRONG_TZ_DIRECTION",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    inboxItems: [
      {
        id: "email-jp-body",
        senderEmail: "alumni@example.com",
        senderName: "田中 健一",
        subject: "OB訪問のお願い",
        snippet:
          "OB訪問の件、来週の以下の時間帯でお伺いできますでしょうか。",
        body: [
          "Ryuto様",
          "",
          "ご無沙汰しております。田中です。",
          "OB訪問の件、来週の以下の時間帯でお伺いできますでしょうか。",
          "",
          "5月20日(水) 19:00開始 (1時間程度)",
          "",
          "ご都合いかがでしょうか。何卒よろしくお願いいたします。",
          "",
          "田中",
        ].join("\n"),
        receivedAt: "2026-05-12T08:00:00Z",
      },
    ],
  },
  input: {
    userMessage: "このメール本文の時間、私のTZだと何時？",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    {
      kind: "tool_called",
      name: "infer_sender_timezone",
    },
    // The core WRONG_TZ_DIRECTION assertion: conversion must go FROM
    // Asia/Tokyo TO America/Vancouver. If this passes, the failure
    // mode is caught at the source — irrespective of how the agent
    // worded the response.
    {
      kind: "tool_called",
      name: "convert_timezone",
      argsMatch: (args) => {
        const a = args as { fromTz?: string; toTz?: string };
        return (
          a.fromTz === "Asia/Tokyo" && a.toTz === "America/Vancouver"
        );
      },
    },
    // Response must include the user-side TZ (PT/PDT/PST). The JST
    // anchor is required *somewhere* in the response — either a "JST"
    // label, an explicit Tokyo reference, or quoting the original
    // 19:00 (which is the sender-side wall clock). The wrong-direction
    // signature "PDT → JST" must be absent.
    { kind: "response_matches", regex: /\bP(D|S)?T\b/ },
    {
      kind: "custom",
      label: "response anchors to the sender's TZ (JST/Tokyo/19:00)",
      check: (r) => {
        const t = r.finalText;
        const ok = t.includes("JST") || t.includes("Tokyo") || t.includes("東京") || t.includes("19:00");
        return {
          pass: ok,
          message: ok
            ? undefined
            : "Response didn't anchor the original time to the sender's TZ.",
        };
      },
    },
    {
      kind: "response_does_not_contain",
      text: "PDT → JST",
    },
    {
      kind: "response_does_not_contain",
      text: "PT → JST",
    },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
