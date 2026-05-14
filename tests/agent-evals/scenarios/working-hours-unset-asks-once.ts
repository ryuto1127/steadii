// Scenario: USER_WORKING_HOURS is unset. The agent is asked to reply
// to a slot-proposing email. SLOT FEASIBILITY CHECK rule 5 says: ASK
// the user once before drafting; do NOT silently default to "all hours
// acceptable". This scenario gates that path.
//
// Expected behavior:
// - Agent asks "what time of day works for you?" (or equivalent).
// - Agent does NOT emit a complete draft body in this turn.
// - Optionally calls save_working_hours if the user message embedded an
//   answer (this scenario's input doesn't, so the save isn't required).
//
// Failure shape this gates: silent default to "all-hours" (which would
// produce a 2 AM acceptance on the first JST recruiter that lands).

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "working-hours-unset-asks-once",
  failureMode: "LATE_NIGHT_SLOT_ACCEPTED_BLINDLY",
  fixture: {
    user: {
      id: "user-ryuto-new",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "田中 太郎",
    },
    // Explicitly null — the harness should emit "(not set)" so the
    // SLOT FEASIBILITY CHECK onboarding-ask branch fires.
    workingHoursLocal: null,
    inboxItems: [
      {
        id: "email-first-slots",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "次回面接のご連絡",
        snippet:
          "下記3候補からご都合の良い時間帯をお選びください。各60分程度を想定しております。",
        body: [
          "田中様",
          "",
          "お世話になっております。アクメトラベルの採用担当でございます。",
          "次回面接の候補として下記3つの日程をご提案いたします。",
          "各60分程度を想定しております。",
          "",
          "候補1: 2026年5月15日(金) 10:00-11:00 (JST)",
          "候補2: 2026年5月19日(火) 16:30-18:00 (JST)",
          "候補3: 2026年5月22日(金) 13:30-14:00 (JST)",
          "",
          "ご返信いただけますと幸いです。",
          "何卒よろしくお願い申し上げます。",
          "",
          "アクメトラベル 採用担当",
        ].join("\n"),
        receivedAt: "2026-05-13T05:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-first",
        kind: "org",
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        description: "新卒採用面接プロセス中の旅行会社",
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-first-slots"],
      },
    ],
  },
  input: {
    userMessage: "アクメトラベル の面接日程のメールに返信したい",
  },
  expect: [
    // (a) MUST ask about working hours / available time of day before
    // shipping a complete draft. Accept many natural phrasings —
    // model variance on mini-tier means the exact phrasing isn't
    // stable; we just gate on "the response makes an availability ask
    // OR surfaces a save_working_hours action".
    {
      kind: "custom",
      label: "response asks about working / available hours",
      check: (r) => {
        const t = r.finalText;
        const askKeywords =
          /(何時|時間帯|何時から何時|対応可能.{0,5}時間|お時間.{0,30}(教え|聞かせ|ご都合)|稼働時間|勤務時間|普段の.{0,10}時間|希望の.{0,10}時間|working hours|what time of day|availability|times of day|available between|when (you|are you) (typically|usually|generally|free)|your (working|available|preferred) hours|when works for you)/i.test(
            t
          );
        // Also accept if the response surfaces a save_working_hours
        // action button or explicit example like "9 AM–10 PM Pacific" —
        // these signal the same intent as an explicit ask.
        const surfacesSaveAction =
          /save_working_hours/.test(t) ||
          /[0-9]{1,2}\s*(AM|PM).{0,30}(Pacific|PT|PDT|PST|local)/i.test(t);
        // Also accept if the response includes the user's TZ name as
        // the asked-about anchor (the model converts the question into
        // "what's your Vancouver window"-style framing).
        const usesTzAnchorInAsk =
          /(教えて|聞かせて|教えてください|お知らせ).{0,80}(時間|Pacific|PT|hour|window)/i.test(
            t
          );
        const asks = askKeywords || surfacesSaveAction || usesTzAnchorInAsk;
        return {
          pass: asks,
          message: asks
            ? undefined
            : "Response did not ask the user for their working / available hours. SLOT FEASIBILITY CHECK rule 5 requires asking once before drafting when USER_WORKING_HOURS is (not set).",
        };
      },
    },
    // (b) MUST NOT ship a complete draft body in this turn. Heuristic:
    // a draft body has BOTH a greeting AND a closing AND a sign-off.
    {
      kind: "custom",
      label:
        "no complete draft body emitted in the same turn (greeting + closing + sign-off all present = a complete draft)",
      check: (r) => {
        const t = r.finalText;
        const hasGreeting =
          t.includes("お世話になっております") ||
          t.includes("お疲れ様") ||
          /Hi\s+\S/.test(t);
        const hasClosing =
          t.includes("よろしくお願い") ||
          t.includes("Best,") ||
          t.includes("Sincerely") ||
          t.includes("Regards");
        const hasSignOff =
          t.includes("田中") ||
          t.includes("竜都") ||
          t.includes("Ryuto");
        const completeDraft = hasGreeting && hasClosing && hasSignOff;
        return {
          pass: !completeDraft,
          message: !completeDraft
            ? undefined
            : "Response shipped a complete draft (greeting + closing + sign-off) even though USER_WORKING_HOURS is unset. The agent must ASK first, save_working_hours, then draft on a follow-up turn.",
        };
      },
    },
    // (c) MUST NOT accept a slot in this turn (no acceptance language).
    {
      kind: "response_does_not_match",
      regex:
        /(承知しました|参加可能です|問題ありません).{0,80}(候補|5\/1[5-9]|5\/2[0-9])/,
    },
    // (d) Canonical entity name appears (the user said "アクメトラベル" —
    // grounding is still required even on a clarification turn).
    { kind: "response_contains", text: "アクメトラベル" },
    // (e) No placeholder leaks
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
