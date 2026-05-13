// Scenario: happy-path absence-email control case.
//
// User asks to draft "skip all my classes tomorrow" emails. We
// expect: (a) a calendar lookup to discover tomorrow's classes, and
// (b) the response to mention at least one professor name from the
// fixture — proving the agent fetched real data instead of writing
// a generic template.

import type { EvalScenario } from "../harness";

// Build "tomorrow at 15:30 PT" / "tomorrow at 10:00 PT" relative to
// current run time. The agent computes "tomorrow" from its system
// clock at run time, so anchoring fixture events to a hard-coded date
// (e.g. 2026-05-13) means the dispatcher's date-range filter would
// reject them whenever the suite ran on any other day.
function tomorrowAt(hours: number, minutes = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  // Anchor a wall-clock PT time using the offset that's roughly
  // accurate for the test machine. The exact offset doesn't matter
  // for date-range filtering (which is what the dispatcher checks);
  // the calendar_list_events dispatcher just needs the timestamp to
  // fall inside the agent's tomorrow window.
  d.setUTCHours(hours + 7, minutes, 0, 0);
  return d.toISOString();
}

const scenario: EvalScenario = {
  name: "happy-path-absence-mail",
  failureMode: undefined,
  fixture: {
    user: {
      id: "user-ryuto",
      timezone: "America/Vancouver",
      locale: "ja",
      name: "Ryuto",
    },
    calendarEvents: [
      {
        id: "ev-mat-tom",
        title: "MAT223 Lecture (Prof. Tanaka)",
        description:
          "Instructor: Prof. Hiroshi Tanaka. Email: tanaka@uoftoronto.ca",
        startsAt: tomorrowAt(15, 30),
        endsAt: tomorrowAt(16, 50),
        location: "BA 1130",
      },
      {
        id: "ev-csc-tom",
        title: "CSC110 Tutorial (TA Marc Rivera)",
        description: "TA: Marc Rivera. Email: marc.rivera@uoftoronto.ca",
        startsAt: tomorrowAt(10, 0),
        endsAt: tomorrowAt(11, 0),
        location: "BA 2135",
      },
    ],
  },
  input: {
    userMessage: "明日のクラスは全部欠席する。先生宛のメール、案だけ作って。",
  },
  expect: [
    { kind: "tool_called", name: "calendar_list_events" },
    // The response must surface at least one instructor name from
    // the fixture — that's the grounding signal.
    {
      kind: "custom",
      label: "response mentions at least one instructor name",
      check: (r) => {
        const t = r.finalText;
        const found =
          t.includes("Tanaka") ||
          t.includes("田中") ||
          t.includes("Rivera") ||
          t.includes("リベラ");
        return {
          pass: found,
          message: found
            ? undefined
            : `Expected an instructor name from the fixture. Final: ${t.slice(
                0,
                400
              )}`,
        };
      },
    },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
