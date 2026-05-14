// Scenario: THREAD_ROLE_CONFUSED — specifically the quoted-block variant
// where the recruiter's NEW message proposes alternative slots and the
// QUOTED history below it contains the user's previous reply AND the
// recruiter's original first round. The agent must extract slots from
// the NEW section ONLY, not from quoted history.
//
// 2026-05-14 verbatim dogfood reproduction:
//   - Recruiter NEW content proposes: 5/20 18:00–18:45 JST + 5/21 15:00–15:45 JST
//   - Quoted reply (Ryuto's previous): 5/22 13:30, 5/15 12:30, 5/15 12:00
//   - Quoted original (round 1 from recruiter): 5/15 10-11/11:30-13:00, 5/19 16:30-18:00, 5/22 13:30-14:00
//
// Agent in the actual dogfood produced a draft that listed the ROUND-1
// candidates (5/15/5/19/5/22) as if they were still on the table —
// extracting from the deepest `>>` quoted block instead of the NEW
// top-of-body content. This is exactly the failure mode engineer-53's
// MUST-rule 9 was supposed to cover but didn't enforce strongly enough.
//
// Failure modes this scenario gates:
// - THREAD_ROLE_CONFUSED (quoted-block variant) — primary
// - Tangential: PLACEHOLDER_LEAK if the agent fakes slots; covered already

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "quoted-block-extraction",
  failureMode: "THREAD_ROLE_CONFUSED",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "田中 太郎",
    },
    workingHoursLocal: { start: "08:00", end: "22:00" },
    facts: [
      { fact: "Vancouverに住んでいる", category: "location" },
    ],
    inboxItems: [
      {
        id: "email-acme-round2",
        senderEmail: "candidate-001@example-ats.example.com",
        senderName: "株式会社アクメトラベル 採用担当",
        subject: "Re: Re: 【アクメトラベル】選考結果のご連絡",
        snippet:
          "ご面接日程のご希望をご回答いただきましてありがとうございます。誠に申し訳ございませんが、いただいた日程につきまして、面接官の調整が難しくなってしまい、以下のいずれかでのご参加は可能でしょうか。",
        body: [
          "田中 太郎　さま",
          "",
          "お世話になっております。アクメトラベル採用担当でございます。",
          "ご面接日程のご希望をご回答いただきましてありがとうございます。",
          "",
          "誠に申し訳ございませんが、いただいた日程につきまして、面接官の調整が難しくなってしまい、以下のいずれかでのご参加は可能でしょうか。",
          "（オンラインにて、30~45分を想定しております。）",
          "",
          "＜候補日程＞",
          "・2026/5/20 (水)　18:00 〜 18:45",
          "・2026/5/21 (木)　15:00 〜 15:45",
          "",
          "以上でございます。",
          "ご不明点などがございましたら、お気軽にご連絡くださいませ。",
          "",
          "引き続きどうぞよろしくお願いいたします。",
          "",
          "採用担当",
          "",
          "",
          "> 返信遅れました。",
          ">",
          "> 以下の希望でお願いします。",
          ">",
          "> 第一希望：5月22日（金） 13：30〜14：00",
          "> 第二希望：5月15日（金） 12：30〜13：00",
          "> 第三希望：5月15日（金） 12：00〜12：30",
          ">",
          "> On Mon, May 11, 2026 at 1:05 AM 株式会社アクメトラベル 採用担当 <",
          "> candidate-001@example-ats.example.com> wrote:",
          ">",
          "> > 田中 太郎 さま",
          "> >",
          "> > お世話になっております。アクメトラベル採用担当でございます。",
          "> > この度は、グループディスカッション選考にご参加いただきまして、ありがとうございました。",
          "> >",
          "> > 慎重な選考の結果、田中さまにはぜひ次回ステップにお進みいただきたく思っております。",
          "> >",
          "> > ＜候補日程＞",
          "> > ・2026/5/15 (金) 10:00 〜 11:00の間、11:30 〜 13:00の間",
          "> > ・2026/5/19 (火) 16:30 〜 18:00の間",
          "> > ・2026/5/22 (金) 13:30 〜 14:00",
          "> >",
          "> > 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-14T08:07:57Z",
      },
    ],
    entities: [
      {
        id: "ent-acme",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        description: "新卒採用面接プロセス中の旅行会社",
        primaryEmail:
          "candidate-001@example-ats.example.com",
        linkedInboxItemIds: ["email-acme-round2"],
      },
    ],
  },
  input: {
    userMessage:
      "アクメトラベルから返信が来てるから返信したい",
  },
  expect: [
    // Must fetch the body before drafting (engineer-53 rule)
    { kind: "tool_called", name: "email_get_body" },
    // Convert each NEW slot to user-local (2 slots × 2 endpoints = 4 calls)
    { kind: "tool_called", name: "convert_timezone", minTimes: 4 },
    // No placeholder leaks
    { kind: "response_no_placeholder_leak" },
    // NEW content must surface
    {
      kind: "custom",
      label: "response cites NEW slot 5/20 18:00 (top of body)",
      check: (r) => {
        const t = r.finalText;
        // The new round-2 slot 5/20 18:00 must appear (in whatever date format)
        const pass = /5[\/月]20|05[\/月]20|May\s*20/i.test(t) && /18:?00/.test(t);
        return {
          pass,
          message: pass
            ? undefined
            : "Response did not cite the NEW slot 5/20 18:00 from the top-of-body section. Agent likely extracted from quoted history.",
        };
      },
    },
    {
      kind: "custom",
      label: "response cites NEW slot 5/21 15:00 (top of body)",
      check: (r) => {
        const t = r.finalText;
        const pass = /5[\/月]21|05[\/月]21|May\s*21/i.test(t) && /15:?00/.test(t);
        return {
          pass,
          message: pass
            ? undefined
            : "Response did not cite the NEW slot 5/21 15:00 from the top-of-body section. Agent likely extracted from quoted history.",
        };
      },
    },
    // Quoted-history slots must NOT be treated as currently-on-the-table
    // candidates. We allow them to APPEAR in the response (e.g. agent
    // referencing "前回は 5/22 を希望しました が…") but not as if the
    // sender is currently proposing them.
    {
      kind: "custom",
      label: "response does not treat quoted-history slots as current candidates",
      check: (r) => {
        const t = r.finalText;
        // Failure shape: response lists 5/15, 5/19, 5/22 as "ご提示いただいた候補" / "the proposed slots" — that's pulling from the deepest quoted block.
        const offered5_15 = /(?:候補|提示|propos)[^。\n]*5[\/月]15/i.test(t);
        const offered5_19 = /(?:候補|提示|propos)[^。\n]*5[\/月]19/i.test(t);
        const pass = !(offered5_15 || offered5_19);
        return {
          pass,
          message: pass
            ? undefined
            : "Response framed 5/15 or 5/19 as currently-proposed slots — those are in the QUOTED history (round-1), not in the NEW round-2 content. THREAD_ROLE_CONFUSED — re-read the body and extract only the section above the first `>` line.",
        };
      },
    },
  ],
};

export default scenario;
