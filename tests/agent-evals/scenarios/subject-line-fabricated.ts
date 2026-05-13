// Scenario: SUBJECT_LINE_FABRICATED_ON_REPLY.
//
// Origin: 2026-05-13 dogfood. Agent emitted a draft body that opened
// with `件名: Re: 次回面接日程のご連絡` even though Gmail auto-prefixes
// `Re:` on a reply — the fabricated subject is dead weight at best,
// misleading at worst (the agent's invented subject often diverges from
// the real thread's subject). Fix in engineer-53: EMAIL REPLY WORKFLOW
// MUST-rule 4 in main.ts + self-critique FORBIDDEN_TOKENS regex
// `/^\s*(件名|Subject)\s*[:：]\s*Re:/im`.
//
// Assertion is precise: the draft body MUST NOT begin with a `件名:` /
// `Subject:` line followed by `Re:`. Other body content (sign-off,
// slot list) is exercised in email-reply-terse-typo.ts.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "subject-line-fabricated",
  failureMode: "SUBJECT_LINE_FABRICATED_ON_REPLY",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "畠山 竜都",
    },
    inboxItems: [
      {
        id: "email-recruiter-subject",
        senderEmail: "recruiter@example.co.jp",
        senderName: "サンプル株式会社 採用担当",
        subject: "面談日程のご連絡",
        snippet:
          "面談の日程をご相談させてください。下記候補からご都合の良い時間帯をお選びください。",
        body: [
          "畠山様",
          "",
          "お世話になっております。サンプル株式会社の採用担当でございます。",
          "下記の通り面談の候補日程をご提案いたします。",
          "",
          "候補1: 2026年5月20日(水) 14:00-15:00 (JST)",
          "候補2: 2026年5月21日(木) 10:00-11:00 (JST)",
          "",
          "ご都合いかがでしょうか。",
          "",
          "サンプル株式会社 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T02:00:00Z",
      },
    ],
  },
  input: {
    userMessage:
      "サンプル株式会社からのメール、返信のドラフトを作って。",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    // The core assertion: the draft body MUST NOT begin with a `件名:` /
    // `Subject:` line followed by `Re:`. This is the named failure mode.
    {
      kind: "response_does_not_match",
      regex: /^\s*(件名|Subject)\s*[:：]\s*Re:/im,
    },
    // No 〇〇 / {name} placeholder leak — we want the draft to be real
    // even if the agent gets the subject right.
    { kind: "response_no_placeholder_leak" },
    // The draft must include at least one body-derived value — either
    // a slot/date the sender proposed, the org name, the meeting purpose,
    // or the explicit "候補N" label that proves the agent parsed the
    // body's slot list. Any of these confirms the agent read the body
    // (vs shipping a generic "ご連絡ありがとうございます" shape).
    {
      kind: "custom",
      label: "draft references at least one body-derived value (slot / org / 候補)",
      check: (r) => {
        const t = r.finalText;
        const found =
          t.includes("サンプル") ||
          t.includes("採用") ||
          t.includes("面談") ||
          t.includes("候補") ||
          t.includes("5月20日") ||
          t.includes("5月21日") ||
          t.includes("14:00") ||
          t.includes("10:00");
        return {
          pass: found,
          message: found
            ? undefined
            : "Draft didn't reference any body-derived value (slot / org / meeting purpose / 候補) — looks like a generic shape, not body-grounded prose.",
        };
      },
    },
  ],
};

export default scenario;
