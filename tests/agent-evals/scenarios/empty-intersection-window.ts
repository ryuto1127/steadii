// Scenario: empty bidirectional intersection. User in Europe/Berlin
// with tight evening working hours (17:00–22:00 CEST) + Japanese
// recruiter (09:00–18:00 JST). User's window in JST = 24:00–05:00
// next-day. Sender's = 09:00–18:00 JST. Intersection = ∅.
//
// The recruiter proposes a specific slot 10:00–11:00 JST = Berlin
// 03:00–04:00 CEST (deep night for user, fine for sender). The
// agent must:
//   1. Recognize 03:00 Berlin is OUTSIDE the user's 17:00–22:00 window.
//   2. Compute the counter-proposal intersection — discover it's empty.
//   3. Say so plainly and offer weekend / out-of-hours fallback.
//   4. Disclose the sender-side reasoning (the secretary's "thinking
//      out loud" surface).
//
// engineer-56 — gates COUNTER-PROPOSAL PATTERN rule 3e (empty
// intersection branch).

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "empty-intersection-window",
  failureMode: "SENDER_NORMS_IGNORED",
  fixture: {
    user: {
      id: "user-berlin-evening",
      timezone: "Europe/Berlin",
      locale: "en",
      name: "Lena Müller",
    },
    // 17:00–22:00 Berlin CEST = JST 24:00–05:00 next-day. No overlap
    // with sender's 09:00–18:00 JST.
    workingHoursLocal: { start: "17:00", end: "22:00" },
    inboxItems: [
      {
        id: "email-acme-empty",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "Acme Travel Recruiting",
        subject: "Interview slot proposal",
        snippet:
          "Could we schedule the interview for 2026-05-15 10:00–11:00 JST? We're typically available 9 AM – 6 PM JST on weekdays.",
        body: [
          "Hi Lena,",
          "",
          "Thank you for your interest in joining Acme Travel.",
          "We'd like to schedule a 60-minute interview at the following time:",
          "",
          "Slot: 2026-05-15 (Fri) 10:00–11:00 JST",
          "",
          "Our team is typically available 9:00–18:00 JST on weekdays.",
          "Please let us know if this works, or suggest an alternative.",
          "",
          "Best regards,",
          "Acme Travel Recruiting",
        ].join("\n"),
        receivedAt: "2026-05-13T01:30:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme-empty",
        kind: "org",
        displayName: "Acme Travel",
        aliases: ["アクメトラベル"],
        description: "Travel company, interviewing candidate Lena Müller",
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-acme-empty"],
      },
    ],
  },
  input: {
    userMessage: "Please draft a reply to the Acme Travel recruiter.",
  },
  expect: [
    // (a) Body fetched
    { kind: "tool_called", name: "email_get_body" },
    // engineer-62 — slot-extraction surface MUST be the stripped body.
    { kind: "tool_called", name: "email_get_new_content_only" },
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
          /(JST.{0,15}(9|09)[:時].{0,15}(18|6 ?PM|6PM)|(9|09)[:時]?\d*\s*[-–~〜]\s*(18|6 ?PM)\s*JST|9 ?AM.{0,10}6 ?PM.{0,10}JST|recruiter(?:'s)?\s+(?:working|business|standard)\s+hours|9:00.{0,10}18:00.{0,10}JST)/i;
        const pass = calledTool || senderHourPattern.test(t);
        return {
          pass,
          message: pass
            ? undefined
            : "Neither infer_sender_norms was called nor inline sender-hours reasoning surfaced.",
        };
      },
    },
    // (c) Slot endpoint(s) converted to user's TZ — the agent must
    // know 10:00 JST = 03:00 CEST to reject it.
    { kind: "tool_called", name: "convert_timezone", minTimes: 1 },
    // (d) PRIMARY — response acknowledges the slot doesn't fit AND
    // either offers a weekend / out-of-hours fallback OR pushes back
    // for a new window. Multiple acceptable phrasings.
    {
      kind: "custom",
      label:
        "response acknowledges slot mismatch and pushes back / offers fallback",
      check: (r) => {
        const t = r.finalText;
        const hits =
          /(weekend|after[\s-]hours|outside\s+(?:my|the|your)\s+(?:usual|standard|working|business)\s+(?:hours|availability)|outside\s+your\s+\d|don'?t\s+overlap|no\s+overlap|do not overlap|cannot find a (?:slot|time|window)|hard to find (?:a slot|overlap)|wouldn'?t overlap|don'?t align|no\s+mutual|no\s+matching\s+(?:slot|window|time)|outside\s+normal\s+business\s+hours|early morning|evening (?:might )?(?:work|be|on)|flexibility (?:on (?:your|their) side)?|flexible (?:slot|window)|push back|ask for another window|propose (?:an? )?alternative|suggest (?:an? )?alternative|reschedule|different (?:slot|time|window))/i.test(
            t
          );
        return {
          pass: hits,
          message: hits
            ? undefined
            : "Response did not acknowledge the slot mismatch or offer an alternative path. With no weekday overlap, the agent must say so plainly (e.g. 'outside your hours, let me ask for another window' / 'weekend would work').",
        };
      },
    },
    // (e) Sender-side reasoning surfaced — proves the agent considered
    // the sender's day.
    {
      kind: "custom",
      label: "response discloses sender-side reasoning",
      check: (r) => {
        const t = r.finalText;
        const hits =
          /(sender(?:'s)?\s+(?:working|business|standard)\s+hours|their\s+(?:working|business|standard)\s+hours|sender(?:'s)?\s+side|their\s+side|both\s+sides|the\s+recruiter(?:'s)?\s+(?:working|business|standard)\s+hours|acme.{0,40}(?:hours|working|business|9|6 PM|18:00|9 AM)|\bJST\b.{0,40}(?:9|6 PM|18:00|18:00 JST|9 AM)|9 AM.{0,40}6 PM.{0,10}JST)/i.test(
            t
          );
        return {
          pass: hits,
          message: hits
            ? undefined
            : "Response did not surface sender-side reasoning.",
        };
      },
    },
    // (f) Mentions the user's TZ explicitly somewhere — CET/CEST/Berlin
    // — so the user can verify the conversion themselves. Avoids the
    // "JST without user-local nearby" PLACEHOLDER_LEAK regression.
    {
      kind: "custom",
      label: "response anchors to the user's local TZ (CET/CEST/Berlin)",
      check: (r) => {
        const t = r.finalText;
        const hits = /\b(CET|CEST|Berlin|Central European)\b/i.test(t);
        return {
          pass: hits,
          message: hits
            ? undefined
            : "Response did not anchor to the user's local TZ (CET/CEST/Berlin). When mentioning the sender's JST hours, the user-side equivalent must also appear so the user can verify the conversion.",
        };
      },
    },
    // (g) Canonical entity name
    { kind: "response_contains", text: "Acme Travel" },
  ],
};

export default scenario;
