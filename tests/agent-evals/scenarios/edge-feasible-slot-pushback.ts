// Scenario: EDGE-FEASIBLE slot — the proposed time is technically inside
// USER_WORKING_HOURS but lies within 60 minutes of either boundary, so a
// "fit-the-user" secretary would silently accept while a senior secretary
// would offer a counter AND keep the user in the loop.
//
// Failure shape this scenario gates: EDGE_FEASIBLE_SLOT_AUTO_ACCEPTED —
// agent treats an edge-of-window slot as a clean accept, skips the counter
// + user-choice flow, and the user ends up at a 21:30 meeting they could
// have politely deferred. SLOT FEASIBILITY CHECK rule 4a (B+C combination)
// is the gate.
//
// Fixture: non-recruiting variant (project review with a consulting firm)
// so the scenario exercises the rule outside the recruiting case shape.
// USER_WORKING_HOURS = 09:00–22:00 user-TZ. The one proposed slot maps
// to 21:30 user-TZ — inside the window but 30 minutes from the end.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "edge-feasible-slot-pushback",
  failureMode: "EDGE_FEASIBLE_SLOT_AUTO_ACCEPTED",
  fixture: {
    user: {
      id: "user-edge-feasible",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "田中 太郎",
    },
    workingHoursLocal: { start: "09:00", end: "22:00" },
    facts: [
      { fact: "Vancouverに住んでいる", category: "location" },
    ],
    inboxItems: [
      {
        id: "email-project-review",
        senderEmail: "contact@sample-consulting.example.co.jp",
        senderName: "サンプルコンサル 田中",
        subject: "案件レビュー日程のご相談",
        snippet:
          "下記日程でご相談できますでしょうか。",
        body: [
          "田中 太郎 様",
          "",
          "お世話になっております。サンプルコンサルの田中です。",
          "案件レビューの日程につきまして、下記でご相談できますでしょうか。",
          "",
          "5月22日(金) 13:30〜14:30 (JST)",
          "",
          "ご都合いかがでしょうか。何卒よろしくお願い申し上げます。",
        ].join("\n"),
        receivedAt: "2026-05-18T01:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-sample-consulting",
        kind: "org",
        displayName: "サンプルコンサル株式会社",
        aliases: ["Sample Consulting"],
        description: "進行中の業務委託案件のコンサル会社",
        primaryEmail: "contact@sample-consulting.example.co.jp",
        linkedInboxItemIds: ["email-project-review"],
      },
    ],
  },
  input: {
    userMessage: "サンプルコンサルの案件レビュー日程の相談に返信したい",
  },
  expect: [
    // (a) Tool chain
    { kind: "tool_called", name: "email_get_body" },
    { kind: "tool_called", name: "email_get_new_content_only" },
    { kind: "tool_called", name: "convert_timezone", minTimes: 1 },

    // (b) Did NOT silently accept the edge-feasible slot as-is.
    // 5/22 13:30 JST = 5/21 21:30 PDT — inside 09:00–22:00 PT but 30min
    // from the 22:00 boundary. An auto-accept here is exactly what 4a
    // gates against. Acceptance language adjacent to the slot date/time
    // = fail.
    {
      kind: "custom",
      label: "did not silently accept the edge-feasible slot",
      check: (r) => {
        const t = r.finalText;
        const acceptVerb =
          /(承知しました|承諾いたします|参加可能|問題ありません|問題なく|お受けします|works for me|sounds good|that works|will join|happy to take)/i;
        const slotToken = /(5\/22|5月22日|13:30|14:30|21:30|9:30 ?PM)/i;
        // Acceptance verb within 120 chars of a slot token (either direction).
        const acceptNearSlot =
          new RegExp(`${acceptVerb.source}.{0,120}${slotToken.source}`, "i").test(
            t,
          ) ||
          new RegExp(`${slotToken.source}.{0,120}${acceptVerb.source}`, "i").test(
            t,
          );
        return {
          pass: !acceptNearSlot,
          message: acceptNearSlot
            ? "Agent appears to accept the 5/22 13:30 JST (= 5/21 21:30 PDT) slot as-is. That slot is 30min from the 22:00 PT end-of-day boundary — EDGE-FEASIBLE rule 4a requires counter + user-choice, not silent acceptance."
            : undefined,
        };
      },
    },

    // (c) Counter draft body emitted (fenced code block with greeting + closing).
    {
      kind: "custom",
      label: "counter draft body emitted (fenced code block)",
      check: (r) => {
        const t = r.finalText;
        const reFence = /```[ \t]*[a-z]*\n([\s\S]*?)\n[ \t]*```/g;
        let m: RegExpExecArray | null;
        let foundDraft = false;
        while ((m = reFence.exec(t)) !== null) {
          const body = m[1];
          if (
            (/(お世話になっております|お疲れ様|Dear\s|Hi\s)/.test(body)) &&
            (/(よろしくお願い|Best,|Sincerely|Regards)/.test(body))
          ) {
            foundDraft = true;
            break;
          }
        }
        return {
          pass: foundDraft,
          message: foundDraft
            ? undefined
            : "No fenced code block containing a draft body (greeting + closing) was emitted. EDGE-FEASIBLE rule 4a requires a counter draft inside a code block; the user-choice prose alone is not enough.",
        };
      },
    },

    // (d) Counter window includes BOTH sender-TZ AND user-TZ ranges.
    // COUNTER-PROPOSAL PATTERN rule 3 now requires dual-TZ display in
    // the proposed alternative window — user-TZ-only ("13:00〜21:00
    // バンクーバー時間") is the exact production-dogfood failure
    // shape this is gating against.
    {
      kind: "custom",
      label: "counter window includes both sender-TZ AND user-TZ ranges",
      check: (r) => {
        const t = r.finalText;
        // Range = HH:MM–HH:MM. Sender-TZ range = HH:MM–HH:MM near a
        // JST/Asia-Tokyo marker. User-TZ range = HH:MM–HH:MM near a
        // PT/PDT/PST/Vancouver/Pacific marker. We look for at least one
        // of each somewhere in the response.
        const senderRange =
          /\b\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}\b[^\n]{0,30}(?:JST|日本時間|Asia\/Tokyo)|(?:JST|日本時間|Asia\/Tokyo)[^\n]{0,30}\b\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}\b/i;
        const userRange =
          /\b\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}\b[^\n]{0,30}(?:P(D|S)?T|バンクーバー|Pacific|Vancouver)|(?:P(D|S)?T|バンクーバー|Pacific|Vancouver)[^\n]{0,30}\b\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}\b/i;
        const hasSender = senderRange.test(t);
        const hasUser = userRange.test(t);
        return {
          pass: hasSender && hasUser,
          message:
            hasSender && hasUser
              ? undefined
              : `Counter window missing one side — sender-TZ range found=${hasSender}, user-TZ range found=${hasUser}. COUNTER-PROPOSAL PATTERN rule 3 requires HH:MM–HH:MM ranges in BOTH TZs side-by-side. The 2026-05-18 prod dogfood failed on exactly this shape (user-TZ only).`,
        };
      },
    },

    // (e) The user-choice prose offer (C component of B+C).
    {
      kind: "custom",
      label:
        "trailing prose surfaces user-choice (accept original as-is option)",
      check: (r) => {
        const t = r.finalText;
        // Look for shapes that let the user opt back to accepting the
        // edge slot. Accept a broad range of phrasings — the rule fires
        // a wide variety of natural language patterns.
        const userChoiceCues =
          /((候補|そのまま|元の.{0,10}日程|original|slot).{0,40}(で\s*OK|そのまま|受けて|構わない|fine|accept).{0,80}(返してください|お返しください|お知らせください|教えてください|言ってください|say|tell me|let me know|reply))|((もし|if).{0,30}(そのまま|候補|slot|そちら|original).{0,60}(OK|受け|構わ|fine|accept))/i;
        return {
          pass: userChoiceCues.test(t),
          message: userChoiceCues.test(t)
            ? undefined
            : "Response does not offer the user the choice to accept the original edge slot as-is. EDGE-FEASIBLE rule 4a step 2 (C component) requires an explicit 'if you'd rather accept slot N as-is, say X' offer in meta-prose outside the draft.",
        };
      },
    },

    // (f) Edge-position acknowledged in intro (MUST-rule 11 binding).
    {
      kind: "custom",
      label: "intro acknowledges the edge-position of the slot",
      check: (r) => {
        const t = r.finalText;
        const edgePhrase =
          /(ギリギリ|ぎりぎり|境目|境界|対応時間の(終わり|始まり)|終わり際|間際|right at the (start|end)|edge of (the )?(window|hours|day)|just before .{0,5}(end|close|boundary))/i;
        return {
          pass: edgePhrase.test(t),
          message: edgePhrase.test(t)
            ? undefined
            : "Intro does not acknowledge that the slot is at the edge of user hours (expected phrases like 'ギリギリ', '対応時間の終わり', 'right at the end of my hours'). MUST-rule 11 + EDGE-FEASIBLE rule 4a step 3 require this disclosure.",
        };
      },
    },

    // (g) Canonical entity name appears
    { kind: "response_contains", text: "サンプルコンサル" },

    // (h) Standard placeholder leak gate
    { kind: "response_no_placeholder_leak" },

    // (i) Sign-off uses user's real name when draft emitted
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
            : "Draft body emitted but sign-off lacks user's real name.",
        };
      },
    },
  ],
};

export default scenario;
