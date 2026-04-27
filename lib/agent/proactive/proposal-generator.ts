import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { ActionOption } from "@/lib/db/schema";
import type { DetectedIssue } from "./types";
import {
  loadProactiveFeedbackBias,
  type ProactiveFeedbackBias,
} from "./feedback-bias";
import {
  PROACTIVE_ALLOWED_TOOLS,
  ensureDismissOption,
  parseGeneratorOutput,
  shouldGenerateActionsFor,
} from "./proposal-parser";

export {
  PROACTIVE_ALLOWED_TOOLS,
  isAllowedProactiveTool,
  parseGeneratorOutput,
  shouldGenerateActionsFor,
} from "./proposal-parser";

// LLM-driven step that turns a (rule-detected) DetectedIssue into a
// final ActionOption[] menu. The rule writes the reasoning + summary;
// the generator picks 2-4 high-value action keys + writes
// human-readable labels per D9. dismiss is always appended last.
//
// Cost target per D7: ~5-10 credits per call using gpt-5.4-mini.

const SYSTEM_PROMPT = `You generate the action-button menu for a Steadii proactive proposal.

Steadii is a proactive AI agent for university students. The scanner has already detected an issue and written its reasoning. Your job is to pick 2-4 specific actions the student can take in one click — and write the button labels.

INPUT
- issueType: one of time_conflict, exam_conflict, deadline_during_travel, exam_under_prepared, workload_over_capacity, syllabus_calendar_ambiguity
- summary, reasoning: 1-line and multi-line context the rule wrote
- sourceRefs: pointers back to the originating records (calendar event, assignment, exam, class)
- (sometimes) feedbackHint: how this user has historically responded to this issueType

ALLOWED tool keys (MUST pick from this set; do not invent):
- email_professor: opens a draft email to the relevant professor (Gmail send tool, queued via undo window)
- reschedule_event: opens calendar update flow for the conflicting event
- delete_event: deletes a calendar event (destructive — use sparingly)
- create_task: creates a Steadii task (e.g., "review notes", "draft email")
- chat_followup: opens a new Steadii chat seeded with the issue context for iteration
- add_mistake_note: prompts the user to add a study note (only meaningful for exam_under_prepared)
- link_existing: marks two ambiguous records as the same (only meaningful for syllabus_calendar_ambiguity)
- add_anyway: adds a record despite ambiguity (only meaningful for syllabus_calendar_ambiguity)
- dismiss: hide this notice for 24h

RULES
1. Pick 2-4 actions matching the issueType. ALWAYS include dismiss as the last option.
2. The first action should be the most concrete / high-impact one for the issue.
3. Labels are short (≤ 60 chars), in the user's input language. Reference real names / dates from sourceRefs verbatim — don't paraphrase ("CSC110 試験 5/16 14:00").
4. Each option carries a payload object with the tool's required args. Include event/assignment/class IDs from sourceRefs so the resolver can act without re-querying.
5. For email_professor: payload includes \`{ classId, professorName?, draftHint }\`.
6. For reschedule_event / delete_event: payload includes \`{ eventId }\`.
7. For create_task: payload includes \`{ title, dueAt? }\`.
8. For chat_followup: payload includes \`{ seedMessage }\`.
9. If feedbackHint says the user dismisses this issueType frequently — keep it conservative: lead with chat_followup or dismiss. If they act, lead with the strongest concrete option.
10. Output JSON — no prose.`;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          tool: {
            type: "string",
            enum: PROACTIVE_ALLOWED_TOOLS as readonly string[],
          },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["key", "label", "description", "tool", "payload"],
      },
    },
  },
  required: ["actions"],
} as const;

export type GenerateProposalArgs = {
  userId: string;
  issue: DetectedIssue;
};

export type GenerateProposalResult = {
  actions: ActionOption[];
  feedback: ProactiveFeedbackBias | null;
  usageId: string | null;
};

export async function generateProposalActions(
  args: GenerateProposalArgs
): Promise<GenerateProposalResult> {
  const feedback = await loadProactiveFeedbackBias({
    userId: args.userId,
    issueType: args.issue.issueType,
  });

  const baselineFallback = (): ActionOption[] => {
    const seed = args.issue.baselineActions ?? [];
    if (seed.some((a) => a.tool === "dismiss")) return seed;
    return [
      ...seed,
      {
        key: "dismiss",
        label: "Dismiss",
        description: "Hide this notice for 24 hours.",
        tool: "dismiss",
        payload: {},
      },
    ];
  };

  return Sentry.startSpan(
    {
      name: "agent.proactive.generate_proposal",
      op: "llm",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.task_type": "proactive_proposal",
        "steadii.issue_type": args.issue.issueType,
      },
    },
    async () => {
      const model = selectModel("proactive_proposal");
      const userContent = buildUserContent(args.issue, feedback);

      try {
        const resp = await openai().chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "proactive_proposal",
              strict: false,
              schema: JSON_SCHEMA,
            },
          },
        });

        const rec = await recordUsage({
          userId: args.userId,
          model,
          taskType: "proactive_proposal",
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
          cachedTokens:
            (
              resp.usage as {
                prompt_tokens_details?: { cached_tokens?: number };
              }
            )?.prompt_tokens_details?.cached_tokens ?? 0,
        });

        const parsed = parseGeneratorOutput(
          resp.choices[0]?.message?.content ?? "{}"
        );
        if (!parsed) {
          return {
            actions: baselineFallback(),
            feedback,
            usageId: rec.usageId,
          };
        }

        // Always force a dismiss option last so users have an out.
        const actions = ensureDismissOption(parsed);
        return { actions, feedback, usageId: rec.usageId };
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            feature: "proactive_proposal_generator",
            issueType: args.issue.issueType,
          },
        });
        return { actions: baselineFallback(), feedback, usageId: null };
      }
    }
  );
}

function buildUserContent(
  issue: DetectedIssue,
  feedback: ProactiveFeedbackBias | null
): string {
  const parts: string[] = [];
  parts.push(`issueType: ${issue.issueType}`);
  parts.push(`summary: ${issue.issueSummary}`);
  parts.push(`reasoning: ${issue.reasoning}`);
  parts.push("sourceRefs:");
  for (const ref of issue.sourceRefs) {
    parts.push(`  - kind=${ref.kind} id=${ref.id} label="${ref.label}"`);
  }
  if (feedback?.hint) {
    parts.push(`feedbackHint: ${feedback.hint}`);
  }
  return parts.join("\n");
}

