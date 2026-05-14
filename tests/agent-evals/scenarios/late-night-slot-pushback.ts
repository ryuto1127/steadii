// Scenario: real-world dogfood reproduction — recruiter proposes 2
// alternative slots, BOTH of which land in the user's night when
// converted to Pacific. The agent must NOT auto-accept; it must push
// back with a counter-proposal that names the user-local time as the
// reason and proposes an alternative window in JST.
//
// Verbatim 2026-05-13 dogfood fixture (アクメトラベル round-2):
//   5/20 (水) 18:00–18:45 JST  →  5/20 02:00–02:45 PDT (Vancouver night)
//   5/21 (木) 15:00–15:45 JST  →  5/20 23:00–23:45 PDT (Vancouver night)
//
// USER_WORKING_HOURS preset to 08:00–22:00 Vancouver. Both proposed
// slots are outside this window.
//
// Failure modes this scenario gates:
// - LATE_NIGHT_SLOT_ACCEPTED_BLINDLY (engineer-54) — primary
// - WORKING_HOURS_IGNORED (engineer-54) — MUST-rule 7 violation
// - Past-pattern grounding: the chatHistory carries Ryuto's earlier
//   reply with 3 evening-PT slots so PAST PATTERN GROUNDING can fire.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "late-night-slot-pushback",
  failureMode: "LATE_NIGHT_SLOT_ACCEPTED_BLINDLY",
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
      {
        fact: "夜遅い時間帯のミーティングは避けたい",
        category: "schedule",
      },
    ],
    inboxItems: [
      {
        id: "email-acme-round1-from-user",
        senderEmail: "admin@example.com",
        senderName: "田中 太郎",
        subject: "Re: 次回面接のご連絡",
        snippet:
          "下記の通り、希望日程をお送りいたします。第一希望：5月15日(金) 11:30〜12:00 JST...",
        body: [
          "アクメトラベル 採用担当者様",
          "",
          "お世話になっております。田中 太郎です。",
          "ご連絡ありがとうございます。",
          "",
          "下記の通り、希望日程をお送りいたします。",
          "第一希望：5月15日(金) 11:30〜12:00 JST (バンクーバー: 5月14日(木) 19:30〜20:00 PT)",
          "第二希望：5月19日(火) 16:30〜17:00 JST (バンクーバー: 5月19日(火) 00:30〜01:00 PT)",
          "第三希望：5月22日(金) 13:30〜14:00 JST (バンクーバー: 5月21日(木) 21:30〜22:00 PT)",
          "",
          "何卒よろしくお願いいたします。",
          "田中 太郎",
        ].join("\n"),
        receivedAt: "2026-05-10T18:00:00Z",
      },
      {
        id: "email-acme-round2",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "Re: Re: 次回面接のご連絡",
        snippet:
          "ご返信ありがとうございます。誠に恐れ入りますが、ご提示いただいた日程ではいずれも調整が難しく、下記2候補をご検討いただけますでしょうか。",
        body: [
          "田中様",
          "",
          "お世話になっております。アクメトラベルの採用担当でございます。",
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
          "アクメトラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T01:30:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-pushback",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        description: "新卒採用面接プロセス中の旅行会社（round 2)",
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: [
          "email-acme-round1-from-user",
          "email-acme-round2",
        ],
      },
    ],
  },
  input: {
    userMessage: "アクメトラベル の二回目のメールに返信したい",
  },
  expect: [
    // (a) MUST chain — body fetch is non-negotiable
    { kind: "tool_called", name: "email_get_body" },
    // (b) MUST resolve sender TZ + convert each proposed slot
    {
      kind: "custom",
      label: "sender TZ resolved before drafting",
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
              : "Neither infer_sender_timezone nor convert_timezone(fromTz=Asia/Tokyo) was called before drafting.",
        };
      },
    },
    // (c) MUST convert EACH proposed slot — 2 slots, so ≥2 calls
    { kind: "tool_called", name: "convert_timezone", minTimes: 2 },
    // (d) MUST cite the Vancouver night time as the reason for push-back
    {
      kind: "custom",
      label: "response cites Vancouver night time (2 AM or 11 PM)",
      check: (r) => {
        const t = r.finalText;
        // The proposed slots convert to ~02:00 (and ~23:00) Vancouver.
        // Any of these tokens proves the user-local time was surfaced.
        // PT/PDT in proximity also qualifies via the dual-TZ display.
        const ptHits = (t.match(/\b(0?2:0\d|02時|23:|23時|11\s?PM|2\s?AM)\b/i) ?? []).length;
        return {
          pass: ptHits >= 1,
          message:
            ptHits >= 1
              ? undefined
              : "Response did not surface the converted Vancouver night time (expected ~02:00 / 23:00 PT or '2 AM' / '11 PM'). Without naming the user-local time, the push-back has no anchor and reads as a vague refusal.",
        };
      },
    },
    // (e) MUST NOT blindly accept either slot
    {
      kind: "custom",
      label: "did not blindly accept either proposed slot",
      check: (r) => {
        const t = r.finalText;
        // Look for an acceptance phrase paired with a slot reference.
        // Acceptance forms: 参加可能/問題ありません/承知しました…で参加/sounds good…
        const blindAccept =
          /(承知しました|かしこまりました|了解いたしました).{0,80}(候補A|候補B|5\/20|5\/21|18:00|15:00)/.test(
            t
          ) ||
          /(参加可能|問題ありません|問題なく).{0,80}(候補A|候補B|5\/20|5\/21|18:00|15:00)/.test(
            t
          ) ||
          /(works for me|sounds good|that works).{0,80}(5\/20|5\/21|18:00|15:00)/i.test(
            t
          );
        return {
          pass: !blindAccept,
          message: blindAccept
            ? "Response appears to accept one of the proposed slots without push-back. Both slots land in the user's night (02:00 / 23:00 PT) — SLOT FEASIBILITY CHECK should have ruled them out."
            : undefined,
        };
      },
    },
    // (f) MUST express infeasibility / push-back tone. Multiple JA forms
    // are acceptable — the model picks among 難しい / 厳しい / 外れます /
    // 深夜 / 夜間 depending on phrasing; any one is sufficient evidence
    // the slot was rejected.
    {
      kind: "response_matches",
      regex:
        /(難しい|難しく|厳しい|厳しく|外れます|外れる|深夜|夜間|対応できかね|ご対応が|cannot|wouldn'?t work|won'?t work|outside (my )?working hours|不可)/i,
    },
    // (g) MUST propose an alternative window with CONCRETE HOURS. The
    // handoff spec prefers the window framed in the sender's TZ (JST);
    // a user-TZ-framed window is also acceptable as long as it carries
    // concrete HH:MM-style hours the recruiter can convert. Vague
    // phrases ("平日の日中", "もう少し調整") are NOT acceptable — no
    // hours = no tractable counter-proposal.
    {
      kind: "custom",
      label:
        "proposes alternative window with concrete HH:MM hours (JST or user-TZ framing)",
      check: (r) => {
        const t = r.finalText;
        // Look for concrete hours adjacent to a TZ marker. Accept either
        // sender-TZ (JST/日本時間/Asia/Tokyo) or user-TZ (PT/PDT/PST/
        // バンクーバー時刻/バンクーバー時間/Pacific) framing.
        const hourTokenRe =
          /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2}時)\s*[-–~〜から]\s*([0-9]{1,2}:[0-9]{2}|[0-9]{1,2}時)/;
        const tzAnchorRe =
          /(JST|日本時間|Asia\/Tokyo|P(D|S)?T|バンクーバー時刻|バンクーバー時間|Pacific|America\/Vancouver)/i;
        // Window heuristic: hour-range AND a TZ anchor within ~120 chars.
        if (!hourTokenRe.test(t) || !tzAnchorRe.test(t)) {
          return {
            pass: false,
            message:
              "Response lacks a concrete hour range tied to a TZ marker. COUNTER-PROPOSAL PATTERN requires naming hours the recruiter can act on (e.g. '9:00–14:00 JST' or '8:00–22:00 PT').",
          };
        }
        // Require proximity: at least one hour-range within 120 chars
        // of a TZ marker. Iterate the text positions for each hour-range
        // match and check for nearby TZ.
        let proximityOk = false;
        const hourRe = new RegExp(hourTokenRe.source, "g");
        let m: RegExpExecArray | null;
        while ((m = hourRe.exec(t)) !== null) {
          const idx = m.index;
          const winStart = Math.max(0, idx - 120);
          const winEnd = Math.min(t.length, idx + m[0].length + 120);
          if (tzAnchorRe.test(t.slice(winStart, winEnd))) {
            proximityOk = true;
            break;
          }
        }
        return {
          pass: proximityOk,
          message: proximityOk
            ? undefined
            : "Response has hour ranges AND a TZ anchor but they're not adjacent — recruiter can't infer which TZ the hours are in. Place the TZ marker within ~120 chars of the hour range.",
        };
      },
    },
    // (h) No placeholder leaks (SUBJECT_LINE / 〇〇 / trailing-action)
    { kind: "response_no_placeholder_leak" },
    // (i) Canonical entity name appears
    { kind: "response_contains", text: "アクメトラベル" },
    // (j) Sign-off uses real name when a draft body is emitted
    {
      kind: "custom",
      label:
        "sign-off uses user's real name when draft is emitted (no 〇〇 / {name})",
      check: (r) => {
        const t = r.finalText;
        const hasPlaceholder = /〇〇|○○|◯◯|\{(name|名前|署名)\}/.test(t);
        if (hasPlaceholder) {
          return {
            pass: false,
            message:
              "Response contains a placeholder (〇〇 / {name} / etc.).",
          };
        }
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
          t.includes("田中") || t.includes("竜都") || t.includes("Ryuto");
        return {
          pass: hasRealName,
          message: hasRealName
            ? undefined
            : "Draft body emitted but the sign-off did not include the user's real name (田中 / 竜都 / Ryuto).",
        };
      },
    },
    // (k) Draft body wrapped in fenced code block (MUST-rule 10)
    {
      kind: "custom",
      label: "draft body wrapped in fenced code block (when draft emitted)",
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
        const fenceCount = (t.match(/^```/gm) ?? []).length;
        return {
          pass: fenceCount >= 2,
          message:
            fenceCount >= 2
              ? undefined
              : `Draft emitted but not wrapped in a fenced code block (found ${fenceCount} fence markers; need ≥2).`,
        };
      },
    },
  ],
};

export default scenario;
