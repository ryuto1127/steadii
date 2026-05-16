// Scenario: real-world dogfood reproduction — recruiter proposes 2
// alternative slots, BOTH of which land in the user's night when
// converted to Pacific. The agent must NOT auto-accept; it must push
// back with a counter-proposal that names the user-local time as the
// reason and proposes an alternative window in JST.
//
// engineer-56 revision — the counter-proposal window must reflect the
// BIDIRECTIONAL intersection of user-norms AND sender-norms. For this
// fixture: USER_WORKING_HOURS 08:00–22:00 PT = JST 00:00–15:00 next-day;
// sender (recruiter@acme-travel.example.co.jp via infer_sender_norms) =
// 09:00–18:00 JST @ 0.9 confidence. Intersection = JST 09:00–15:00.
// Pre-engineer-56 a JST 6:00–14:00 proposal would have "passed" because
// it fit the user side, even though 6 AM JST is pre-business for the
// sender — that's SENDER_NORMS_IGNORED. The revised assertion enforces
// that the proposed JST window stays inside 09:00–18:00 JST.
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
// - SENDER_NORMS_IGNORED (engineer-56) — counter must respect sender's day
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
    // engineer-62 — slot-extraction surface MUST be the stripped body.
    { kind: "tool_called", name: "email_get_new_content_only" },
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
    // (c) MUST convert EACH proposed slot — 2 slots × 2 endpoints
    // (start + end) = 4 calls floor per TIMEZONE RULES "for slot
    // RANGES, convert BOTH endpoints" rule. Pre-2026-05-14 this said
    // minTimes: 2 (start only); upgraded after Ryuto's dogfood showed
    // PDT side rendering only the start (`02:00 PDT` instead of
    // `02:00–02:45 PDT`) — RANGE_END_NOT_CONVERTED failure mode.
    { kind: "tool_called", name: "convert_timezone", minTimes: 4 },
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
        /(難しい|難しく|厳しい|厳しく|外れます|外れる|範囲外|範囲を外れ|深夜|夜間|対応時間外|対応できかね|ご対応が|都合がつかない|都合が合わ|cannot|wouldn'?t work|won'?t work|outside (my )?working hours|out of office hours|outside business hours|不可|遅い時間|遅く)/i,
    },
    // (g0) engineer-56 — bidirectional consideration. Either calls
    // `infer_sender_norms` OR demonstrates the sender's hours
    // explicitly in the response (e.g. "JST 9:00–18:00" anchored to
    // sender / 業務時間 / working hours). Tool-call preferred but
    // mini-tier model variance sometimes inlines the prior; either
    // path satisfies the rule's intent.
    {
      kind: "custom",
      label:
        "bidirectional consideration: infer_sender_norms called OR sender hours explicitly reasoned",
      check: (r) => {
        const calledTool = r.toolCalls.some((c) => c.name === "infer_sender_norms");
        // Inline reasoning fallback: response mentions a concrete
        // sender-hours window like "JST 9:00–18:00" / "9 AM – 6 PM
        // JST" / "9–18 JST" in proximity to a sender-norms framing
        // word.
        const t = r.finalText;
        const senderHourPattern =
          /(JST.{0,15}(9|09)[:時].{0,15}(18|6 ?PM|6 PM|6PM)|(9|09)[:時]?\d*\s*[-–~〜]\s*(18|6 ?PM)\s*JST|9 ?AM.{0,10}6 ?PM.{0,10}JST|相手の(対応|営業|稼働|業務)時間|sender(?:'s)?\s+(?:working|business|standard)\s+hours|recruiter(?:'s)?\s+(?:working|business|standard)\s+hours)/i;
        const inlineReasoning = senderHourPattern.test(t);
        const pass = calledTool || inlineReasoning;
        return {
          pass,
          message: pass
            ? undefined
            : "Agent neither called infer_sender_norms NOR surfaced concrete sender-hours reasoning. Bidirectional intersection (COUNTER-PROPOSAL PATTERN rule 3b) requires one or the other.",
        };
      },
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
    // (j2) engineer-56 — proposed JST window respects sender norms
    // (09:00–18:00 Asia/Tokyo). Any JST hour explicitly proposed in
    // the counter must fall inside [09, 18]. Parsing approach: only
    // consider HH:MM tokens that are tightly anchored to a JST marker
    // AND not within the user-side context (バンクーバー時刻 / PT / PDT)
    // — that way the analysis-section "5/20 02:00–02:45 PT" doesn't
    // get counted as a JST proposal.
    {
      kind: "custom",
      label:
        "proposed JST window respects sender norms (no hour < 09:00 or > 18:00 JST)",
      check: (r) => {
        const t = r.finalText;
        const tzRe = /\b(JST|日本時間|Asia\/Tokyo)\b/g;
        const hits: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = tzRe.exec(t)) !== null) {
          // Tight window — JST proposals are typically written as
          // "JST 9:00–14:00" or "9:00–14:00 JST" with the HH:MM
          // directly adjacent to the marker.
          const winStart = Math.max(0, m.index - 20);
          const winEnd = Math.min(t.length, m.index + m[0].length + 20);
          const slice = t.slice(winStart, winEnd);
          // Skip hours that have a PT / PDT / バンクーバー marker in the
          // wider 80-char neighborhood — those are user-side mentions,
          // not JST proposals.
          const wideStart = Math.max(0, m.index - 80);
          const wideEnd = Math.min(
            t.length,
            m.index + m[0].length + 80
          );
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
              : `Counter-proposal includes JST hour(s) ${outOfBand.join(
                  ", "
                )} outside the sender's 09:00–18:00 working window (SENDER_NORMS_IGNORED).`,
        };
      },
    },
    // (j3) engineer-56 — sender-side reasoning surfaced to the user.
    // Disclosure proves the agent considered both sides. Accept many
    // natural phrasings (Japanese 業務時間 / 対応時間 / 営業時間 /
    // 稼働時間, 向こう側, 相手の…時間, English variants).
    {
      kind: "custom",
      label:
        "response discloses sender-side reasoning ('the sender's working hours' / '向こう側' / etc.)",
      check: (r) => {
        const t = r.finalText;
        const hits =
          /(向こう側|相手の(対応|営業|稼働|業務)時間|sender(?:'s)?\s+(?:working|business|standard)\s+hours|sender(?:'s)?\s+side|their\s+(?:working|business|standard)\s+hours|their\s+side|both\s+sides|お互いの.{0,15}(時間|対応|営業|業務)|recipient'?s\s+(?:working|business)\s+hours|recipient'?s\s+side|recruiter(?:'s)?\s+(?:working|business|standard)\s+hours|recruiter(?:'s)?\s+side|相手も.{0,10}(業務|営業|稼働|対応)時間|相手側.{0,20}(時間|業務|営業))/i.test(
            t
          );
        return {
          pass: hits,
          message: hits
            ? undefined
            : "Response did not disclose sender-side reasoning. COUNTER-PROPOSAL PATTERN rule 3f requires explaining to the user that the proposed window respects BOTH sides (e.g. '相手の業務時間を JST 9:00–18:00 と想定したので…' / 'I assumed the sender's working hours are around 9 AM – 6 PM JST').",
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
    // 2026-05-15 sparring — MUST-rule 11: response opens with an
    // establishing sentence, not a conjunction. The 2026-05-15 dogfood
    // had the agent start with 「ただ、あなたの対応可能時間は…」 — reverse-
    // direction conjunction without prior context.
    {
      kind: "custom",
      label: "response does not open with a conjunction",
      check: (r) => {
        const t = r.finalText.trimStart();
        const opensWithConjunction =
          /^(ただ|でも|それで|しかし|However|But|And so)[、,\s]/.test(t);
        return {
          pass: !opensWithConjunction,
          message: opensWithConjunction
            ? "Response opens with a conjunction (ただ / でも / However / etc.) — user has no prior context to anchor against. Establish what the email is + what's being asked in the first sentence."
            : undefined,
        };
      },
    },
    // 2026-05-15 sparring — MUST-rule 12: when the draft body references
    // user-local TZ, it must include a location disclosure so the
    // recipient can frame the times. Recruiter doesn't know the user is
    // in Vancouver; "こちらの時間で 02:00 PDT" is ambiguous.
    {
      kind: "custom",
      label:
        "draft body discloses user's location when referencing user-local TZ",
      check: (r) => {
        const t = r.finalText;
        // Extract code blocks
        const blocks: string[] = [];
        const re = /```[ \t]*\n([\s\S]*?)\n[ \t]*```/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t)) !== null) blocks.push(m[1]);
        const draftBlocks = blocks.filter(
          (b) =>
            /(お世話になっております|お疲れ様|Dear\s|Hi\s)/.test(b) &&
            /(よろしくお願いいたします|Best,|Sincerely|Regards)/.test(b)
        );
        if (draftBlocks.length === 0) return { pass: true };
        for (const block of draftBlocks) {
          const refsUserTz =
            /(\bP(D|S)?T\b|Pacific Time|こちらの時間|現地時間|私の時間)/i.test(
              block
            );
          if (!refsUserTz) continue;
          const hasDisclosure =
            /(海外|北米|アメリカ|カナダ|Pacific\s+(?:Time|Standard|Daylight)|Vancouver|Toronto|Berlin|London|New York|在住|住んで|currently based|based in|based out of|海外におり)/i.test(
              block
            );
          if (!hasDisclosure) {
            return {
              pass: false,
              message: `Draft body references user-local TZ (PT/PDT/こちらの時間/etc.) but lacks a location disclosure (海外 / 北米 / Pacific / Vancouver / 在住 / based in). Recipient cannot frame the times — "こちら" is ambiguous. Add a one-sentence disclosure right after お世話になっております.`,
            };
          }
        }
        return { pass: true };
      },
    },
  ],
};

export default scenario;
