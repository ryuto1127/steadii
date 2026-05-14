// Scenario: USER_WORKING_HOURS is unset. The agent is asked to reply
// to a slot-proposing email.
//
// engineer-56 — the previous version of this scenario asserted the
// hard-ASK gate (agent must STOP and ask before drafting). engineer-56
// REMOVED that gate. The new behavior is "soft default": the agent
// proceeds with the norm window for the user's profile TZ
// (America/Vancouver → 09:00–22:00 PT), surfaces the assumption once
// outside the draft, and DOES draft. The asks-once-explicitly path is
// preserved for the case where the user explicitly volunteers their
// hours, but is no longer the default branch.
//
// Revised expectations:
// - Agent SHOULD draft this turn (no hard gate).
// - Agent SHOULD surface the assumption ("Assuming 9 AM – 10 PM
//   Pacific by default" or equivalent) outside the draft body.
// - Agent SHOULD apply the SLOT FEASIBILITY CHECK using the norm
//   default — accepting only the feasible slot (5/15 11:30 JST =
//   5/14 19:30 PT, inside 09:00–22:00 PT) and explicitly skipping
//   the infeasible ones (5/19 16:30 JST = 5/19 00:30 PT,
//   5/22 13:30 JST = 5/21 21:30 PT — last is INSIDE; first/middle
//   only one is outside).
//
// Hour math for the fixture below (vs norm 09:00–22:00 PT):
//   候補1: 5/15 10:00–11:00 JST = 5/14 18:00–19:00 PT (PDT = JST -16h)
//           — INSIDE (18:00 PT is within 09:00–22:00)
//   候補2: 5/19 16:30–18:00 JST = 5/19 00:30–02:00 PT — OUTSIDE (night)
//   候補3: 5/22 13:30–14:00 JST = 5/21 21:30–22:00 PT — borderline
//           (21:30 inside, 22:00 = boundary)
//
// Failure shape this gates (engineer-56 version): the agent reverting
// to the OLD hard-ASK behavior ("I need to know your hours first")
// when the soft default should fire.

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
    // Explicitly null — the harness emits "(not set — using norm: …)"
    // so the engineer-56 soft-default branch fires.
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
    // (a) Body fetched
    { kind: "tool_called", name: "email_get_body" },
    // (b) Each slot converted (3 slots × 2 endpoints minimum, but the
    // agent may legitimately skip end-conversion for slots it's about
    // to reject; gate on ≥ 3 calls minimum).
    { kind: "tool_called", name: "convert_timezone", minTimes: 3 },
    // (c) MUST surface the assumption about norm hours. The disclosure
    // line is the engineer-56 promise: silent default = LATE_NIGHT
    // failure by another route; assumption-disclosed default = working
    // as designed. Accept a wide range of phrasings.
    {
      kind: "custom",
      label:
        "response surfaces the norm-default assumption (e.g. '9:00–22:00 PT as default')",
      check: (r) => {
        const t = r.finalText;
        // Look for: (i) 9 AM / 9:00 / 09:00 mention paired with a 10 PM
        // / 22:00 / Pacific marker, OR (ii) a phrase like "by default"
        // / "as a default" / "仮に" / "デフォルト" / "標準" that signals
        // the agent disclosed the assumption explicitly.
        const hours =
          /(9\s?(?:AM|am)?|0?9:00).{0,40}(10\s?(?:PM|pm)?|22:00|2[12]:00)/i.test(
            t
          ) ||
          /(0?9:00|9\s?AM).{0,80}(Pacific|PT|PDT|PST)/i.test(t);
        const defaultMarker =
          /(by default|as a default|standard hours|仮に|デフォルト|標準|想定して進め|前提として|assume|assuming)/i.test(
            t
          );
        return {
          pass: hours || defaultMarker,
          message:
            hours || defaultMarker
              ? undefined
              : "Response did not surface the norm-default assumption. engineer-56 SLOT FEASIBILITY CHECK rule 0 requires disclosing 'Assuming you're available 9 AM – 10 PM Pacific by default' (or similar) once when drafting without explicit working hours.",
        };
      },
    },
    // (d) Canonical entity name appears
    { kind: "response_contains", text: "アクメトラベル" },
    // (e) No placeholder leaks
    { kind: "response_no_placeholder_leak" },
    // (f) Did NOT revert to the pre-engineer-56 hard-ASK behavior of
    // refusing to draft. The agent should either emit a draft body OR
    // do the secondary explicit-ask path — but it must NOT say
    // "USER_WORKING_HOURS is not set so I cannot proceed". That phrasing
    // is the regression we're guarding against.
    {
      kind: "response_does_not_match",
      regex:
        /(cannot proceed|can'?t proceed|need.{0,20}working hours|need.{0,20}hours.{0,20}first|お時間を教えて.{0,80}までは)/i,
    },
  ],
};

export default scenario;
