// Scenario: recruiter proposes 2 slots; one IS feasible (lands inside
// the user's working hours when converted to Pacific), the other isn't.
// The agent must accept the feasible one AND explicitly mention the
// other was skipped due to time-of-day mismatch — silent filtering is
// wrong.
//
// USER_WORKING_HOURS preset to 08:00–22:00 Vancouver.
//
// Slot A: 5/15 (金) 11:30 JST → 5/14 (木) 19:30 PT  (INSIDE 08:00–22:00 — feasible)
// Slot B: 5/16 (土) 18:00 JST → 5/16 (土) 02:00 PDT (OUTSIDE 08:00–22:00 — infeasible)
//
// Failure modes covered:
// - LATE_NIGHT_SLOT_ACCEPTED_BLINDLY: agent must not just accept B.
// - Silent filtering: agent must NAME slot B explicitly as the skip.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "feasible-and-infeasible-mix",
  failureMode: "LATE_NIGHT_SLOT_ACCEPTED_BLINDLY",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "田中 太郎",
    },
    workingHoursLocal: { start: "08:00", end: "22:00" },
    inboxItems: [
      {
        id: "email-mixed-slots",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "次回面接のご連絡",
        snippet:
          "下記2候補からご都合の良い時間帯をお選びください。各45分程度を想定しております。",
        body: [
          "田中様",
          "",
          "お世話になっております。アクメトラベルの採用担当でございます。",
          "次回面接の候補として下記2つの日程をご提案いたします。",
          "各45分程度を想定しております。",
          "",
          "候補1: 2026年5月15日(金) 11:30-12:15 (JST)",
          "候補2: 2026年5月16日(土) 18:00-18:45 (JST)",
          "",
          "上記からご都合の良い時間帯をお選びいただき、ご返信いただけますと幸いです。",
          "何卒よろしくお願い申し上げます。",
          "",
          "アクメトラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T03:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-mixed",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        description: "新卒採用面接プロセス中の旅行会社",
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-mixed-slots"],
      },
    ],
  },
  input: {
    userMessage: "アクメトラベル の面接日程のメールに返信したい",
  },
  expect: [
    // (a) Body fetched
    { kind: "tool_called", name: "email_get_body" },
    // engineer-62 — slot-extraction surface MUST be the stripped body.
    { kind: "tool_called", name: "email_get_new_content_only" },
    // (b) Both slots converted
    { kind: "tool_called", name: "convert_timezone", minTimes: 2 },
    // (c) The feasible slot MUST be referenced in the response. The
    // proposed slot is 5/15 11:30 JST = 5/14 19:30 PT (Vancouver). The
    // agent may surface it in either TZ (JST date 5/15, or Vancouver
    // date 5/14 with the 19:30 PT time) — both are acceptable, since
    // the underlying meeting is the same.
    {
      kind: "custom",
      label: "feasible slot surfaced (5/15 JST or its 5/14 PT equivalent)",
      check: (r) => {
        const t = r.finalText;
        const hasJstDate = /5[\/月]15/.test(t);
        // Vancouver-converted form: 5/14 with 19:30 PT (or 18:00–20:00
        // adjacent times depending on phrasing). Look for 5/14 + a PT
        // marker + an evening hour.
        const hasPtForm =
          /5[\/月]14.{0,80}\bP(D|S)?T\b/.test(t) ||
          /\bP(D|S)?T\b.{0,80}5[\/月]14/.test(t);
        return {
          pass: hasJstDate || hasPtForm,
          message:
            hasJstDate || hasPtForm
              ? undefined
              : "Response did not surface the feasible slot (5/15 JST or its 5/14 PT equivalent). Agent should have accepted from the feasible subset.",
        };
      },
    },
    // (d) The infeasible slot (5/16 JST = 5/16 PT 02:00) MUST be
    // referenced AND skipped / pushed back, not silently dropped or
    // auto-accepted. Accept either the JST date (5/16) or its PT-
    // converted form (still 5/16 since 18:00 JST → 02:00 PT same day).
    {
      kind: "custom",
      label:
        "infeasible slot 5/16 explicitly skipped (not silently filtered, not auto-accepted)",
      check: (r) => {
        const t = r.finalText;
        const has516 = /5[\/月]16/.test(t);
        if (!has516) {
          return {
            pass: false,
            message:
              "Response did not mention slot 2 (5/16) at all. Silent filtering is wrong — the agent must explicitly say it was skipped due to time-of-day mismatch.",
          };
        }
        // Check that the agent explained WHY (skipped / 難しい / outside
        // hours / etc.) within close proximity to the 5/16 reference, OR
        // anywhere in the response if the response is short (the
        // analysis section may come before the slot list in summary
        // form).
        const explainedSkipNearby =
          /(5[\/月]16).{0,200}(難しい|難しく|厳しい|対応できかね|スキップ|skip|outside|夜間|night|深夜|2[:時]0?[0-9]|02:0?0)/i.test(
            t
          ) ||
          /(難しい|難しく|厳しい|対応できかね|スキップ|skip|outside|夜間|night|深夜|2[:時]0?[0-9]|02:0?0).{0,200}(5[\/月]16)/i.test(
            t
          );
        const hasInfeasReason =
          /(難しい|難しく|厳しい|対応できかね|スキップ|skip|outside|夜間|night|深夜|2[:時]0?[0-9]|02:0?0)/i.test(
            t
          );
        return {
          pass: explainedSkipNearby || (t.length < 400 && hasInfeasReason),
          message:
            explainedSkipNearby || (t.length < 400 && hasInfeasReason)
              ? undefined
              : "Slot 2 (5/16) is mentioned but the response doesn't explain that it was skipped due to time-of-day mismatch. Required: name the reason (e.g. 'バンクーバー時刻で 02:00 になりスキップ' / 'outside working hours').",
        };
      },
    },
    // (e) Dual-TZ display somewhere — PT/PDT/PST must appear.
    { kind: "response_matches", regex: /\bP(D|S)?T\b/ },
    // (f) No placeholder leaks
    { kind: "response_no_placeholder_leak" },
    // (g) Real-name sign-off when draft emitted
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
            message: "Response contains a placeholder (〇〇 / {name}).",
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
            : "Draft body emitted but the sign-off didn't include the user's real name.",
        };
      },
    },
  ],
};

export default scenario;
