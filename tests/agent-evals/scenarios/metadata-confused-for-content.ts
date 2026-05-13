// Scenario: METADATA_CONFUSED_FOR_CONTENT.
//
// Origin: 2026-05-12 dogfood. Agent called lookup_entity to find a
// named org, saw the linked email subject/snippet in the response,
// and answered "the most recent email is about X" — without ever
// fetching the body. The user actually wanted body content. Fix in
// PR #229: "Tool semantics — what each tool actually returns" prompt
// section explicit that lookup_entity returns metadata only.
//
// Assertion: the agent should chain lookup_entity → email_get_body
// (or email_search → email_get_body), not stop at lookup_entity.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "metadata-confused-for-content",
  failureMode: "METADATA_CONFUSED_FOR_CONTENT",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    inboxItems: [
      {
        id: "email-acme-detail",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "次回面接の詳細について",
        snippet: "詳細は本文をご確認ください。",
        body: [
          "Ryuto様",
          "",
          "次回面接の詳細をお送りいたします。",
          "",
          "・会場: 東京都港区 アクメトラベル本社 8階",
          "・面接官: 田中部長、佐藤マネージャー",
          "・所要時間: 60分",
          "・持参物: 履歴書、ポートフォリオ",
          "",
          "ご不明点がございましたらお気軽にご連絡ください。",
        ].join("\n"),
        receivedAt: "2026-05-11T02:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-d",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-acme-detail"],
      },
    ],
  },
  input: {
    userMessage: "アクメトラベルからの最新メールの本文を教えて",
  },
  expect: [
    // Body content must be fetched. The agent may go via lookup_entity
    // first or via email_search first — either is a valid path to the
    // body fetch.
    { kind: "tool_called", name: "email_get_body" },
    // Body-only details from the fixture: must appear in the response.
    { kind: "response_contains", text: "60分" },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
