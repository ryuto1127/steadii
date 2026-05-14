// Scenario: RANGE_AS_ENDPOINT_RIGIDITY.
//
// Origin: scheduling-domain regression. Email says "10:00-11:00 の間"
// + "30分想定". User asks "can I book 10:30?". Agent insists 10:30 is
// "out of range" because it treats the endpoints rigidly instead of
// understanding the range as a slot pool. Fix in PR #212: SCHEDULING
// DOMAIN RULES prompt section.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "range-as-slot-pool",
  failureMode: "RANGE_AS_ENDPOINT_RIGIDITY",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    // engineer-54 — pre-set so the SLOT FEASIBILITY CHECK gate doesn't
    // block older reply scenarios. Already-onboarded user state.
    workingHoursLocal: { start: "08:00", end: "22:00" },
    inboxItems: [
      {
        id: "email-recruiter-range",
        senderEmail: "recruiter@example.co.jp",
        senderName: "サンプル株式会社 採用担当",
        subject: "面談時間のご相談",
        snippet:
          "5月20日(水) 10:00-11:00 の間で30分ほどお時間いただけますでしょうか。",
        body: [
          "Ryuto様",
          "",
          "次回の面談時間ですが、",
          "5月20日(水) 10:00-11:00 の間 で30分程度のお時間をいただけますでしょうか。",
          "",
          "上記時間帯内であればいつでも調整可能です。",
        ].join("\n"),
        receivedAt: "2026-05-12T01:00:00Z",
      },
    ],
  },
  input: {
    userMessage:
      "サンプル株式会社から面談時間のメールが来てる。10:30 で予約できる？",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    // The agent must acknowledge that 10:30 is within the proposed
    // range (i.e. valid). The Japanese natural phrasing varies wildly
    // ("範囲内", "可能", "問題ありません", "に入っています", "予約できる",
    // "OKです", "はい") — accept any positive confirmation phrase.
    // Engineer-53 broadened this list after a 2026-05-13 eval failure
    // where the model said "に入っています" + "予約できる時間です" — both
    // semantically "yes 10:30 is bookable", but neither matched the old
    // narrower keyword list.
    {
      kind: "custom",
      label: "acknowledges 10:30 is bookable within the range",
      check: (r) => {
        const t = r.finalText;
        const acknowledges =
          t.includes("範囲内") ||
          t.includes("可能") ||
          t.includes("問題") ||
          t.includes("入っています") ||
          t.includes("予約できる") ||
          t.includes("OK") ||
          t.includes("はい") ||
          t.toLowerCase().includes("yes") ||
          t.toLowerCase().includes("within") ||
          t.toLowerCase().includes("bookable");
        return {
          pass: acknowledges,
          message: acknowledges
            ? undefined
            : `Expected the agent to confirm 10:30 is bookable. Final: ${r.finalText.slice(
                0,
                400
              )}`,
        };
      },
    },
    // The rigid-endpoint failure mode signature.
    { kind: "response_does_not_contain", text: "候補外" },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
