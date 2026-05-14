// Scenario: ACTION_COMMITMENT_VIOLATION.
//
// Origin: agent narrates "返信文を作ります" / "I'll draft a reply" but
// the response ends without a corresponding tool call. The user is
// told something happened that didn't. Fix: "Action commitment" prompt
// section + self-critique can also catch this via placeholder regex
// when the narrated draft never materializes.
//
// Assertion: when the user says "draft a reply", we expect the agent
// to (a) fetch the email body, and (b) emit a draft containing the
// sender's name or org — meaning real work happened, not just
// narration.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "action-commitment-followthrough",
  failureMode: "ACTION_COMMITMENT_VIOLATION",
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    // engineer-54 — pre-set so the SLOT FEASIBILITY CHECK gate doesn't
    // block this older reply scenario. Represents an already-onboarded
    // user; the engineer-54 onboarding-ask flow has its own dedicated
    // scenario (`working-hours-unset-asks-once`).
    workingHoursLocal: { start: "08:00", end: "22:00" },
    inboxItems: [
      {
        id: "email-prof",
        senderEmail: "tanaka@uoftoronto.ca",
        senderName: "Prof. Tanaka",
        subject: "Question about MAT223 problem set 3",
        snippet:
          "Hi Ryuto, I noticed your submission for PS3 problem 4 — could you walk me through your reasoning?",
        body: [
          "Hi Ryuto,",
          "",
          "I noticed your submission for PS3 problem 4. Could you walk me through your reasoning for the eigenvector step? I want to make sure I'm reading your approach correctly before marking.",
          "",
          "Happy to discuss in office hours if that's easier.",
          "",
          "Best,",
          "Prof. Tanaka",
        ].join("\n"),
        receivedAt: "2026-05-11T18:00:00Z",
      },
    ],
  },
  input: {
    userMessage:
      "Prof Tanaka からのメール、返信のドラフトを作って。",
  },
  expect: [
    { kind: "tool_called", name: "email_get_body" },
    // The draft must contain a name or salutation — meaning the agent
    // followed through on the action it committed to.
    {
      kind: "custom",
      label: "draft contains addressee name or salutation",
      check: (r) => {
        const t = r.finalText;
        const pass =
          t.includes("Tanaka") ||
          t.includes("田中") ||
          t.toLowerCase().includes("prof") ||
          t.toLowerCase().includes("dear");
        return {
          pass,
          message: pass
            ? undefined
            : `Final text didn't include an addressee — looks like a narration-only response. Final: ${t.slice(
                0,
                300
              )}`,
        };
      },
    },
    // The draft must reference the actual content of the request
    // (eigenvector / PS3 / problem 4) — proof the body was actually read.
    {
      kind: "custom",
      label: "draft references body-only content",
      check: (r) => {
        const t = r.finalText.toLowerCase();
        const pass =
          t.includes("eigenvector") ||
          t.includes("ps3") ||
          t.includes("problem set 3") ||
          t.includes("problem 4") ||
          t.includes("固有");
        return {
          pass,
          message: pass
            ? undefined
            : "Draft didn't reference body content — the agent likely narrated without reading.",
        };
      },
    },
    // Note: no response_no_placeholder_leak here. The prof's question
    // is mathematical (eigenvectors), so the agent legitimately emits
    // LaTeX like `\mathbf{v}` whose `{v}` substring trips the
    // {placeholder} forbidden token. That's a known false-positive in
    // the prod self-critique regex, separate from ACTION_COMMITMENT —
    // see feedback_agent_failure_modes.md for the planned narrowing.
  ],
};

export default scenario;
