import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  userFacts: {},
  monthlyDigests: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  gt: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  or: () => ({}),
  sql: () => ({}),
}));
vi.mock("@/lib/agent/user-facts", () => ({
  loadTopUserFacts: async () => [],
  renderUserFactsBlock: () => "",
  markUserFactsUsed: async () => {},
}));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: { completions: { create: async () => ({ choices: [] }) } },
  }),
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usageId: null, usd: 0, credits: 0 }),
}));

import {
  parseSynthesisResponse,
  type MonthlySynthesis,
} from "@/lib/agent/digest/monthly-synthesis";
import { buildMonthlySynthesisUserContent } from "@/lib/agent/digest/prompts/monthly-synthesis-prompt";
import type { MonthlyAggregate } from "@/lib/agent/digest/monthly-aggregation";

const SAMPLE_AGGREGATE: MonthlyAggregate = {
  emailActivity: {
    receivedCount: 200,
    triagedHighCount: 12,
    triagedMediumCount: 80,
    triagedLowCount: 108,
    draftsGenerated: 47,
    draftsApproved: 30,
    draftsDismissed: 9,
    autoSentCount: 5,
    avgResponseLatencyHours: 8.4,
    topSenders: [
      { email: "prof@example.com", received: 12, approved: 10, dismissed: 0 },
    ],
  },
  calendarActivity: {
    eventsAttended: 22,
    eventsMissed: 1,
    averageDailyMeetingHours: 2.3,
    classesAttended: 18,
    classesMissed: 0,
  },
  assignmentActivity: {
    completed: 2,
    inProgressCarryover: 3,
    notStartedCarryover: 0,
    avgLeadTimeBetweenCreatedAndDone: 96,
  },
  chatActivity: {
    sessionCount: 14,
    messageCount: 92,
    voiceSessionCount: 3,
    toolCallCount: 28,
    topToolsUsed: [{ name: "email_search", count: 11 }],
  },
  proactiveActivity: {
    proposalsShown: 7,
    proposalsActedOn: 3,
    proposalsDismissed: 2,
    topRulesFired: [{ rule: "assignment_deadline_reminder", count: 4 }],
  },
  driftSignals: {
    overwhelmedMentions: 4,
    blockedMentions: 1,
    cancelledMeetingsCount: 1,
    fadingContacts: [
      { email: "mei@example.com", daysSinceLastTouch: 23 },
    ],
  },
  comparisons: {},
};

describe("parseSynthesisResponse", () => {
  it("parses a valid response", () => {
    const raw = JSON.stringify({
      oneLineSummary: "Workload concentrated late in the month.",
      themes: [
        {
          title: "CS 348 PS slipping",
          body: "3 assignments in progress, 0 done.",
          evidence: [
            { kind: "assignment", id: "abc", label: "CS 348 PS4" },
          ],
        },
      ],
      recommendations: [
        {
          action: "Block 3 hours Saturday for CS 348 PS4",
          why: "Closes the carryover.",
          suggestedDate: "2026-05-09",
        },
      ],
      driftCallouts: [
        {
          callout: "You haven't messaged Mei in 23 days.",
          severity: "info",
        },
      ],
    });
    const parsed = parseSynthesisResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.themes).toHaveLength(1);
    expect(parsed!.themes[0].title).toBe("CS 348 PS slipping");
    expect(parsed!.recommendations).toHaveLength(1);
    expect(parsed!.driftCallouts[0].severity).toBe("info");
  });

  it("drops themes missing required fields", () => {
    const raw = JSON.stringify({
      oneLineSummary: "x",
      themes: [
        { title: "ok", body: "ok", evidence: [] },
        { title: "missing body" },
      ],
      recommendations: [],
      driftCallouts: [],
    });
    const parsed = parseSynthesisResponse(raw);
    expect(parsed!.themes).toHaveLength(1);
  });

  it("drops drift callouts with invalid severity", () => {
    const raw = JSON.stringify({
      oneLineSummary: "x",
      themes: [],
      recommendations: [],
      driftCallouts: [
        { callout: "ok", severity: "info" },
        { callout: "bad", severity: "critical" }, // not in enum
      ],
    });
    const parsed = parseSynthesisResponse(raw);
    expect(parsed!.driftCallouts).toHaveLength(1);
    expect(parsed!.driftCallouts[0].callout).toBe("ok");
  });

  it("drops evidence rows with invalid kind", () => {
    const raw = JSON.stringify({
      oneLineSummary: "x",
      themes: [
        {
          title: "t",
          body: "b",
          evidence: [
            { kind: "assignment", id: "1", label: "ok" },
            { kind: "made_up", id: "2", label: "bad" },
          ],
        },
      ],
      recommendations: [],
      driftCallouts: [],
    });
    const parsed = parseSynthesisResponse(raw);
    expect(parsed!.themes[0].evidence).toHaveLength(1);
    expect(parsed!.themes[0].evidence[0].kind).toBe("assignment");
  });

  it("returns null on unparseable JSON", () => {
    expect(parseSynthesisResponse("not json")).toBeNull();
  });

  it("returns null on non-object root", () => {
    expect(parseSynthesisResponse("[]")).not.toBeNull(); // Array.isArray catches this
    expect(parseSynthesisResponse('"a string"')).toBeNull();
  });
});

describe("buildMonthlySynthesisUserContent", () => {
  it("includes locale + month label + aggregate + facts", () => {
    const content = buildMonthlySynthesisUserContent({
      locale: "en",
      monthLabel: "April 2026",
      aggregate: SAMPLE_AGGREGATE,
      userFacts: [
        { id: "f1", fact: "Grade 12 student", category: "academic" },
      ],
      priorSynthesis: null,
    });
    expect(content).toContain("Locale: en");
    expect(content).toContain("Month covered: April 2026");
    expect(content).toContain("Grade 12 student");
    expect(content).toContain("[academic]");
    expect(content).toContain("CURRENT MONTH AGGREGATE");
    expect(content).toContain("PRIOR MONTH SYNTHESIS: none");
  });

  it("includes prior synthesis JSON when provided", () => {
    const prior: MonthlySynthesis = {
      oneLineSummary: "Prior summary",
      themes: [],
      recommendations: [],
      driftCallouts: [],
    };
    const content = buildMonthlySynthesisUserContent({
      locale: "ja",
      monthLabel: "2026年4月",
      aggregate: SAMPLE_AGGREGATE,
      userFacts: [],
      priorSynthesis: prior,
    });
    expect(content).toContain("Locale: ja");
    expect(content).toContain("Prior summary");
    expect(content).not.toContain("PRIOR MONTH SYNTHESIS: none");
  });
});
