// Scenario: happy-path week-summary control case.
//
// Sanity check that a vanilla "how's my week?" query doesn't trigger
// any regressions. We expect at least one calendar / week-summary
// tool call and the response to include event titles from the fixture.

import type { EvalScenario } from "../harness";

const scenario: EvalScenario = {
  name: "happy-path-week-summary",
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
        id: "ev-mat",
        title: "MAT223 Lecture",
        startsAt: "2026-05-13T15:30:00-07:00",
        endsAt: "2026-05-13T16:50:00-07:00",
        location: "BA 1130",
      },
      {
        id: "ev-csc",
        title: "CSC110 Tutorial",
        startsAt: "2026-05-14T10:00:00-07:00",
        endsAt: "2026-05-14T11:00:00-07:00",
        location: "BA 2135",
      },
      {
        id: "ev-eng",
        title: "ENG140 Essay Workshop",
        startsAt: "2026-05-15T13:00:00-07:00",
        endsAt: "2026-05-15T14:30:00-07:00",
      },
    ],
    assignments: [
      {
        id: "as-mat-ps4",
        title: "MAT223 Problem Set 4",
        dueAt: "2026-05-17T23:59:00-07:00",
        status: "not_started",
        className: "MAT223",
      },
      {
        id: "as-csc-lab",
        title: "CSC110 Lab 5 writeup",
        dueAt: "2026-05-16T17:00:00-07:00",
        status: "in_progress",
        className: "CSC110",
      },
    ],
  },
  input: {
    userMessage: "今週どんな感じ？",
  },
  expect: [
    // The agent should pull either calendar or week summary — both
    // are reasonable answers to "how's my week".
    {
      kind: "custom",
      label: "called calendar_list_events OR summarize_week",
      check: (r) => {
        const tried = r.toolCalls.filter(
          (c) =>
            c.name === "calendar_list_events" ||
            c.name === "summarize_week"
        );
        return {
          pass: tried.length >= 1,
          message:
            tried.length === 0
              ? `Expected calendar/week tool call; actual: ${r.toolCalls
                  .map((c) => c.name)
                  .join(", ")}`
              : undefined,
        };
      },
    },
    // At least one event title from the fixture should appear in the
    // response. We don't require all three (the agent may summarize).
    {
      kind: "custom",
      label: "response references at least one fixture event/assignment",
      check: (r) => {
        const t = r.finalText;
        const tokens = [
          "MAT223",
          "CSC110",
          "ENG140",
          "Problem Set 4",
          "Lab 5",
        ];
        const found = tokens.filter((tok) => t.includes(tok));
        return {
          pass: found.length >= 1,
          message:
            found.length === 0
              ? `No event/assignment title surfaced. Final: ${t.slice(0, 300)}`
              : undefined,
        };
      },
    },
    { kind: "response_no_placeholder_leak" },
  ],
};

export default scenario;
