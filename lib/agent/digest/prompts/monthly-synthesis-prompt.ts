import type { MonthlyAggregate } from "../monthly-aggregation";
import type { UserFactForPrompt } from "@/lib/agent/user-facts";
import type { MonthlySynthesis } from "../monthly-synthesis";

// engineer-50 — Prompt assembly for the CoS-mode monthly digest. The
// system prompt is stable so the OpenAI prompt cache hits cleanly; the
// user message holds the variable aggregate + facts + prior synthesis.
//
// Keep both ends terse — the aggregate is ~2-3KB JSON, the prior
// synthesis adds another ~1KB, and the user facts top out around 1KB.
// Total: well inside the model's prompt-cache window.

export const MONTHLY_SYNTHESIS_SYSTEM_PROMPT = `You are Steadii's Chief of Staff layer. Once per month you read a structured aggregate of a university student's activity (email, calendar, assignments, chats, proactive proposals, drift signals) and produce a strategic monthly digest.

You are NOT a daily/weekly EA — those layers already exist. Your job is pattern recognition and dot-connecting across the full month. Examples of CoS-grade observations:

- "This month you replied to 47 emails but 9 were dismissed unread — is that bucket worth reviewing?"
- "Your 3 group-project meetings all slipped past their planned end times — pattern or coincidence?"
- "You said 'I'm overwhelmed' to chat 4 times this month. Earlier in the term it was zero. Worth a structural look?"
- "5 assignments touched this month, 2 done, 3 still in_progress. Compare to last month's velocity."
- "You haven't talked to Mei in 23 days; you used to ping her every ~5 days. Drifted?"

OPERATING RULES (strict):

1. EVIDENCE-FIRST. Every theme and every drift callout must cite at least one evidence row from the aggregate. Do not invent patterns. If there's nothing notable in a section, do not invent something.

2. STRATEGIC, NOT TACTICAL. Tactical EA tasks ("reply to this email", "reschedule this meeting") are out of scope. You operate on the monthly time horizon: trends, drifts, pattern shifts, structural recommendations.

3. GROUNDED RECOMMENDATIONS. Recommendations should reference the user's actual data (specific assignments, classes, contacts). Generic advice ("study earlier") is forbidden. Concrete: "Block 3 hours for CS 348 PS4 this Saturday morning" — cites the assignment that surfaced in the aggregate.

4. LOCALE. The user's locale is supplied. If "ja", produce JA-primary text in every field. If "en", produce EN. Never mix unless the user mixed them in their own data (preserve verbatim names).

5. ONE-LINE SUMMARY. <120 characters. The thesis of the month in one breath. Not "this month was busy" — that's vacuous. Pick the dominant theme.

6. THEMES. 2-4 themes. Each: title (≤60 chars), body (2-3 sentences grounded in aggregate numbers), evidence (≥1 row pointing to a concrete source). Themes should NOT overlap — pick distinct angles.

7. RECOMMENDATIONS. 2-4 concrete forward-looking actions. Each: action (imperative), why (1 line tying back to aggregate), optionally suggestedDate (ISO if applicable).

8. DRIFT CALLOUTS. Only emit when the aggregate's driftSignals section has non-zero data OR when fadingContacts is non-empty. Severity:
   - info: noteworthy but not urgent ("usually ping Mei every 5 days, now 23")
   - warn: pattern worth attention ("overwhelmed mentioned 4×, was 0 last month")
   - high: structural risk ("9 assignments not started, due dates in window")
   Never emit a callout without evidence.

9. CARRY THEMES ACROSS MONTHS. If a prior-month synthesis is provided AND the current month shows the same pattern, say so explicitly ("Last month: workload was X; this month: Y — same direction") and reference the prior theme by its title.

10. NO HALLUCINATION. Do not invent contacts, classes, assignments, or numbers. Every concrete reference must trace to a row in the aggregate.

Output strict JSON matching the supplied schema. No prose outside the JSON.`;

export const MONTHLY_SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    oneLineSummary: {
      type: "string",
      minLength: 1,
      maxLength: 200,
    },
    themes: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 100 },
          body: { type: "string", minLength: 1, maxLength: 600 },
          evidence: {
            type: "array",
            minItems: 0,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: [
                    "email_thread",
                    "assignment",
                    "event",
                    "chat_session",
                    "proactive_proposal",
                  ],
                },
                id: { type: "string" },
                label: { type: "string", minLength: 1, maxLength: 200 },
              },
              required: ["kind", "id", "label"],
            },
          },
        },
        required: ["title", "body", "evidence"],
      },
    },
    recommendations: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", minLength: 1, maxLength: 200 },
          why: { type: "string", minLength: 1, maxLength: 300 },
          suggestedDate: { type: ["string", "null"] },
        },
        required: ["action", "why", "suggestedDate"],
      },
    },
    driftCallouts: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          callout: { type: "string", minLength: 1, maxLength: 300 },
          severity: { type: "string", enum: ["info", "warn", "high"] },
        },
        required: ["callout", "severity"],
      },
    },
  },
  required: ["oneLineSummary", "themes", "recommendations", "driftCallouts"],
} as const;

export type MonthlySynthesisPromptInput = {
  locale: "en" | "ja";
  monthLabel: string; // e.g. "April 2026" / "2026年4月"
  aggregate: MonthlyAggregate;
  userFacts: UserFactForPrompt[];
  priorSynthesis: MonthlySynthesis | null;
};

// Build the user-message content. Keeps the system prompt stable so
// the prompt cache hits across users — only the user message varies.
export function buildMonthlySynthesisUserContent(
  input: MonthlySynthesisPromptInput
): string {
  const lines: string[] = [];
  lines.push(`Locale: ${input.locale}`);
  lines.push(`Month covered: ${input.monthLabel}`);
  lines.push("");

  if (input.userFacts.length > 0) {
    lines.push("USER FACTS (things Steadii has learned about this student):");
    for (const f of input.userFacts) {
      const tag = f.category ? `[${f.category}] ` : "";
      lines.push(`- ${tag}${f.fact}`);
    }
    lines.push("");
  }

  lines.push("CURRENT MONTH AGGREGATE (JSON):");
  lines.push(JSON.stringify(input.aggregate, null, 2));
  lines.push("");

  if (input.priorSynthesis) {
    lines.push("PRIOR MONTH SYNTHESIS (JSON):");
    lines.push(JSON.stringify(input.priorSynthesis, null, 2));
    lines.push("");
  } else {
    lines.push("PRIOR MONTH SYNTHESIS: none (first digest for this user).");
    lines.push("");
  }

  lines.push(
    "Produce the JSON object exactly per the schema. Reasoning in the user's locale. Do not include keys outside the schema."
  );

  return lines.join("\n");
}
