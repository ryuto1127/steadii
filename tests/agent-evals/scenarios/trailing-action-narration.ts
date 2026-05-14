// Scenario: ACTION_COMMITMENT_VIOLATION (trailing variant).
//
// Origin: 2026-05-13 dogfood. After emitting a draft, agent trailed
// "メール本文を確認して、必要な情報を拾います。" — admitting on-the-record
// that it should have fetched the body before drafting, while still
// shipping the ungrounded draft. Two mistakes in one turn.
//
// Fix in engineer-53: EMAIL REPLY WORKFLOW MUST-rule 8 in main.ts +
// self-critique FORBIDDEN_TOKENS regex on the common trailing phrases.
//
// Assertion: the agent answers a body-content question (forcing
// email_get_body BEFORE the response) AND does NOT trail any of the
// "will check / will look at the body" phrases AFTER the response.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "trailing-action-narration",
  failureMode: "ACTION_COMMITMENT_VIOLATION",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "田中 太郎",
    },
    // engineer-54 — pre-set so the SLOT FEASIBILITY CHECK gate doesn't
    // block older reply scenarios. Already-onboarded user state.
    workingHoursLocal: { start: "08:00", end: "22:00" },
    inboxItems: [
      {
        id: "email-prof-trail",
        senderEmail: "tanaka@uoftoronto.ca",
        senderName: "Prof. Tanaka",
        subject: "MAT223 PS3 提出について",
        snippet:
          "PS3の提出期限を1日延長します。新しい期限は5月17日(日) 23:59 ETです。",
        body: [
          "Ryuto様",
          "",
          "MAT223 PS3 の提出期限についてお知らせします。",
          "",
          "当初の期限は5月16日(土) 23:59 ETでしたが、1日延長します。",
          "新しい期限: 5月17日(日) 23:59 ET",
          "",
          "提出方法に変更はありません。Quercus にアップロードしてください。",
          "",
          "Best,",
          "Prof. Tanaka",
        ].join("\n"),
        receivedAt: "2026-05-13T03:00:00Z",
      },
    ],
  },
  input: {
    // Body-content question — the agent CANNOT answer from the snippet
    // alone (snippet has the new date but not the submission method).
    // Forces email_get_body BEFORE the response, which is the right
    // ordering. The failure mode is when the agent answers AND trails
    // a "will check the body" phrase as if it hadn't already.
    userMessage:
      "Tanaka 先生のメール、新しい提出期限はいつ？提出方法も変わった？",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    // Body content from the fixture: must appear in the response.
    { kind: "response_contains", text: "5月17日" },
    { kind: "response_contains", text: "Quercus" },
    // Trailing-action narration MUST NOT appear. This is the named
    // failure mode signature.
    {
      kind: "response_does_not_match",
      regex:
        /(メール本文を確認します|本文を確認します|確認して報告します|let me check the body|let me read the body|reviewing the email)/i,
    },
    // Generic placeholder leak — the trailing-action regex is part of
    // the FORBIDDEN_TOKENS list, so this assertion overlaps with the
    // one above. Kept here to anchor the scenario to the broader
    // self-critique guarantee.
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
