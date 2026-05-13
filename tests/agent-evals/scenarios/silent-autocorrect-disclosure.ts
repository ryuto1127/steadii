// Scenario: SILENT_AUTOCORRECT.
//
// Origin: 2026-05-12 dogfood. User typed "アクメとラベル" (typo for
// "アクメトラベル"); agent silently rewrote and proceeded as if the
// canonical form had been typed. Risk: high-stakes write to the wrong
// entity. Fix in PR #227: FUZZY MATCH ON ZERO HITS rule — transparent
// disclosure required, not silent correction. Differentiator vs
// ChatGPT.
//
// The harness fixture's lookup_entity returns 0 candidates for
// "アクメとラベル" but matches "アクメ" — same fuzzy-fallback path as prod.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "silent-autocorrect-disclosure",
  failureMode: "SILENT_AUTOCORRECT",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    inboxItems: [
      {
        id: "email-acme-2",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "選考結果のご連絡",
        snippet: "この度はご応募いただきありがとうございました。",
        body: "選考結果のご連絡です。次のステップにお進みいただきます。",
        receivedAt: "2026-05-10T05:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-2",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-acme-2"],
      },
    ],
  },
  input: {
    userMessage: "アクメとラベル からのメールを探して",
  },
  expect: [
    // Either the agent tried lookup_entity OR email_search first;
    // we don't pin the exact first call but require at least one
    // entity / email lookup to have happened.
    {
      kind: "custom",
      label: "called lookup_entity OR email_search at least once",
      check: (r) => {
        const tried = r.toolCalls.filter(
          (c) =>
            c.name === "lookup_entity" || c.name === "email_search"
        );
        return {
          pass: tried.length >= 1,
          message:
            tried.length === 0
              ? `Expected lookup_entity or email_search to be called; actual: ${r.toolCalls
                  .map((c) => c.name)
                  .join(", ")}`
              : undefined,
        };
      },
    },
    // The canonical name MUST appear in the response (transparent
    // correction disclosed the entity it landed on).
    { kind: "response_contains", text: "アクメトラベル" },
    // The typo MUST also appear (transparent disclosure of what the
    // user said vs what we matched).
    { kind: "response_contains", text: "アクメとラベル" },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
