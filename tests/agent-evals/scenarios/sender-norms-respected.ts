// Scenario: user technically COULD take a 23:00 PT or 06:00 PT meeting
// (their explicit working hours are 06:00–23:00 PT — they've told the
// agent they're flexible). But the sender — a Japanese recruiter — has
// a normal 09:00–18:00 JST workday. The counter-proposal MUST STILL
// respect sender norms; proposing JST 02:00 ("which is 10 AM your time
// previous day, well inside your 06–23 range") is rude to the recruiter
// and not what a real secretary would do.
//
// engineer-56 — gates SENDER_NORMS_IGNORED. Even when the user is
// permissive, bidirectional intersection means the JST proposal stays
// inside 09:00–18:00 JST.
//
// Fixture: same 令和トラベル round-2 shape as late-night-slot-pushback,
// but workingHoursLocal explicitly widened to 06:00–23:00 PT. Round 1
// slot 5/22 13:30 JST = 5/21 21:30 PT — INSIDE the wide window, so the
// agent could accept it. But it's the round-2 push-back we test: both
// slots (5/20 18:00 JST = 5/20 02:00 PT, 5/21 15:00 JST = 5/20 23:00
// PT) lie INSIDE the user's 06:00–23:00 PT window when you count 02:00
// PT as the start-of-day. The agent must still recognize they're early
// AM PT and not great. More importantly: the counter-proposal must
// keep JST inside 09:00–18:00 — no 23:00 JST proposals "because the
// user said they're flexible until 23:00 PT".

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "sender-norms-respected",
  failureMode: "SENDER_NORMS_IGNORED",
  fixture: {
    user: {
      id: "user-ryuto-flex",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "畠山 竜都",
    },
    // Permissive — user explicitly told the agent they're free from
    // 06:00 to 23:00 PT. The agent could "fit the user" at JST
    // 23:00 or JST 02:00 — but that's still wrong because the sender
    // is asleep.
    workingHoursLocal: { start: "06:00", end: "23:00" },
    inboxItems: [
      {
        id: "email-reiwa-round2-flexuser",
        senderEmail: "recruiter@reiwa-travel.co.jp",
        senderName: "令和トラベル採用担当",
        subject: "Re: Re: 次回面接のご連絡",
        snippet:
          "ご返信ありがとうございます。誠に恐れ入りますが、ご提示いただいた日程ではいずれも調整が難しく、下記2候補をご検討いただけますでしょうか。",
        body: [
          "畠山様",
          "",
          "お世話になっております。令和トラベルの採用担当でございます。",
          "ご返信誠にありがとうございます。",
          "誠に恐れ入りますが、ご提示いただいた3日程ではいずれも調整が難しく、",
          "下記2候補をご検討いただけますでしょうか。",
          "",
          "候補A: 2026年5月20日(水) 18:00-18:45 (JST)",
          "候補B: 2026年5月21日(木) 15:00-15:45 (JST)",
          "",
          "ご都合の良い方をお選びいただければ幸いです。",
          "ご検討のほど、何卒よろしくお願い申し上げます。",
          "",
          "令和トラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T01:30:00Z",
      },
    ],
    entities: [
      {
        id: "ent-reiwa-flex",
        kind: "org",
        displayName: "令和トラベル",
        aliases: ["Reiwa Travel"],
        description: "新卒採用面接プロセス中の旅行会社（round 2)",
        primaryEmail: "recruiter@reiwa-travel.co.jp",
        linkedInboxItemIds: ["email-reiwa-round2-flexuser"],
      },
    ],
  },
  input: {
    userMessage: "令和トラベル の二回目のメールに返信したい",
  },
  expect: [
    // (a) Body fetched
    { kind: "tool_called", name: "email_get_body" },
    // (b) Bidirectional consideration. Tool-call preferred but accept
    // inline sender-hours reasoning as a fallback (mini-tier variance).
    {
      kind: "custom",
      label:
        "infer_sender_norms called OR sender hours explicitly reasoned",
      check: (r) => {
        const calledTool = r.toolCalls.some(
          (c) => c.name === "infer_sender_norms"
        );
        const t = r.finalText;
        const senderHourPattern =
          /(JST.{0,15}(9|09)[:時].{0,15}(18|6 ?PM|6PM)|(9|09)[:時]?\d*\s*[-–~〜]\s*(18|6 ?PM)\s*JST|9 ?AM.{0,10}6 ?PM.{0,10}JST|相手の(対応|営業|稼働|業務)時間|recruiter(?:'s)?\s+(?:working|business|standard)\s+hours)/i;
        const pass = calledTool || senderHourPattern.test(t);
        return {
          pass,
          message: pass
            ? undefined
            : "Neither infer_sender_norms was called nor inline sender-hours reasoning surfaced.",
        };
      },
    },
    // (c) Each slot converted (start + end = 4 calls floor)
    { kind: "tool_called", name: "convert_timezone", minTimes: 4 },
    // (d) Canonical entity name appears
    { kind: "response_contains", text: "令和トラベル" },
    // (e) PRIMARY assertion — every JST hour proposed in the counter
    // lies inside 09:00–18:00 Asia/Tokyo. SENDER_NORMS_IGNORED gate.
    // Parsing: tight HH:MM proximity (20 chars) + skip if a PT marker
    // is in the 80-char neighborhood (those are user-side mentions).
    {
      kind: "custom",
      label:
        "proposed JST window respects sender norms (no hour < 09 or > 18 JST)",
      check: (r) => {
        const t = r.finalText;
        const tzRe = /\b(JST|日本時間|Asia\/Tokyo)\b/g;
        const hits: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = tzRe.exec(t)) !== null) {
          const winStart = Math.max(0, m.index - 20);
          const winEnd = Math.min(t.length, m.index + m[0].length + 20);
          const slice = t.slice(winStart, winEnd);
          const wideStart = Math.max(0, m.index - 80);
          const wideEnd = Math.min(t.length, m.index + m[0].length + 80);
          const wideSlice = t.slice(wideStart, wideEnd);
          if (/\b(P(D|S)?T|バンクーバー時|Pacific)\b/i.test(wideSlice)) {
            continue;
          }
          const hourRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
          let hm: RegExpExecArray | null;
          while ((hm = hourRe.exec(slice)) !== null) {
            hits.push(Number(hm[1]));
          }
        }
        if (hits.length === 0) return { pass: true };
        const outOfBand = hits.filter((h) => h < 9 || h > 18);
        return {
          pass: outOfBand.length === 0,
          message:
            outOfBand.length === 0
              ? undefined
              : `Counter-proposal references JST hour(s) ${outOfBand.join(
                  ", "
                )} outside the sender's 09:00–18:00 working window. SENDER_NORMS_IGNORED — even when the user is permissive, the bidirectional intersection rule keeps the JST window inside the sender's day.`,
        };
      },
    },
    // (f) Sender-side reasoning surfaced
    {
      kind: "custom",
      label: "response discloses sender-side reasoning",
      check: (r) => {
        const t = r.finalText;
        const hits =
          /(向こう側|相手の(対応|営業|稼働|業務)時間|sender(?:'s)?\s+(?:working|business|standard)\s+hours|their\s+(?:working|business|standard)\s+hours|both\s+sides|お互いの.{0,15}(時間|対応|営業|業務)|recruiter(?:'s)?\s+(?:working|business|standard)\s+hours|相手も.{0,10}(業務|営業|稼働|対応)時間|相手側.{0,20}(時間|業務|営業))/i.test(
            t
          );
        return {
          pass: hits,
          message: hits
            ? undefined
            : "Response did not disclose the sender-side reasoning. With permissive user hours, surfacing the sender-side framing is the only way the user knows the counter respects the recruiter's day.",
        };
      },
    },
    // (g) No placeholder leaks
    { kind: "response_no_placeholder_leak" },
    // (h) Real-name sign-off when draft emitted
    {
      kind: "custom",
      label: "sign-off uses user's real name when draft is emitted",
      check: (r) => {
        const t = r.finalText;
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
            : "Draft emitted but sign-off lacks user's real name.",
        };
      },
    },
  ],
};

export default scenario;
