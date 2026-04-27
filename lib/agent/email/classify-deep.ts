import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { RetrievalProvenance } from "@/lib/db/schema";
import type { SimilarEmail } from "./retrieval";
import type { RiskPassResult } from "./classify-risk";
import {
  buildFanoutContextBlocks,
  type FanoutResult,
} from "./fanout-prompt";

export type DeepAction =
  | "draft_reply"
  | "archive"
  | "snooze"
  | "no_op"
  | "ask_clarifying"
  // polish-7 — "important but no reply needed" branch of the 2-category
  // triage. Surfaces to the user as a pending row (so they don't miss it)
  // but renders no draft form, only a "Read & dismiss" affordance.
  | "notify_only";

export type DeepPassInput = {
  userId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  snippet: string | null;
  bodySnippet: string | null;
  riskPass: RiskPassResult;
  similarEmails: SimilarEmail[];
  totalCandidates: number;
  threadRecentMessages: Array<{ sender: string; snippet: string }>; // last 2 thread predecessors
  // Phase 7 W1 — multi-source fanout. Optional so legacy paths still work
  // (the orchestrator passes it; tests that exercise the prompt shape
  // without DB pass null and get the existing similar-email-only prompt).
  fanout?: FanoutResult | null;
  // polish-7 — per-user feedback for this sender (last N rows). Tells the
  // model what the student has done with prior drafts from this address /
  // domain so it can bias toward their revealed preference. Optional so
  // legacy callers + the empty-state path produce the same prompt shape.
  recentFeedback?: RecentFeedbackSummary | null;
};

// Aggregated counts of how the user has responded to past drafts from
// this sender. Computed in lib/agent/email/feedback.ts; injected as a
// short prompt block. Only one block is added (sender-level OR
// domain-level fallback), so the field carries the resolved scope.
export type RecentFeedbackSummary = {
  scope: "sender" | "domain";
  proposedCounts: Record<string, Record<string, number>>; // proposedAction → userResponse → n
  windowDays: number;
  totalRows: number;
};

export type DeepPassResult = {
  action: DeepAction;
  reasoning: string;
  retrievalProvenance: RetrievalProvenance;
  usageId: string | null;
};

const SYSTEM_PROMPT = `You are Steadii's deep classifier for high-risk emails. You receive:
- the email envelope + snippet
- the cheap risk-pass output (tier + its reasoning)
- a multi-source fanout context: class binding + relevant past mistakes + relevant syllabus chunks + upcoming calendar events/tasks
- up to 20 retrieved similar past emails (subject + snippet + sender)
- the immediately prior 2 messages in the same thread (if any)
- (sometimes) a "Recent feedback from this student for this sender" block: how the student treated past drafts you proposed for the same sender

Decide the action the agent should take. Steadii's mental model is two-category:

CATEGORY A — Reply needed. Sender expects a response from THIS student.
- draft_reply: compose a reply for the user to review.
- ask_clarifying: the email is ambiguous and the user must answer a question before the reply can be drafted.

CATEGORY B — Important, no reply needed. Sender is one-way but content matters to the student.
- notify_only: surfaces to the inbox so the student reads it, no draft generated. Use for: grade posted, scholarship awarded, legal/visa status update, important deadline announcement, course-wide professor announcement, scholarship office FYI, financial aid disbursement notice.

CATEGORY C — Skip.
- archive: receipt/confirmation, newsletter, automated system notification, courtesy CC.
- snooze: reply is needed but not now (waiting on deadline / more info).
- no_op: explicitly nothing to do; dismiss.

Decision rules — apply in order:
1. Reply is needed ONLY when ALL of these hold:
   - Sender expects a response from the student (a question, a request, a scheduling proposal, a confirmation request).
   - The student is the primary audience (not BCC'd; not a 100-recipient course-wide blast).
   - The action is on the student's side (not "FYI", not "we will do X for you").
2. If reply is NOT needed but the content is consequential (grades, scholarships, legal, deadline, important official announcement) → notify_only.
3. If unsure between draft_reply and archive → archive.
4. If unsure between draft_reply and notify_only → notify_only.
5. The cost of a missed draft is one user-driven send (cheap). The cost of a wrong draft is user trust (expensive). Prefer the safer category.

Never choose archive for high-risk items that reference grades, transcripts, supervisors, or admissions — those are notify_only at minimum.

If a "Recent feedback" block is present, use it as a per-user prior. Repeated dismissal of drafts from this sender is strong signal toward notify_only or archive over draft_reply. Repeated send/edit is signal that draft_reply is welcome.

Examples (concise — full reasoning lives in your output):
- Professor: "Are you free Thursday at 2pm to discuss your thesis?" → draft_reply (direct question, primary audience, action on student).
- Registrar: "Your fall grade has been posted to the portal." → notify_only (no reply expected, grade is consequential).
- Course-wide email: "Reminder: midterm Thursday." (sent to 200 students) → notify_only (consequential but no individual reply needed).
- Newsletter from Coursera digest → archive (promo, not consequential).
- Professor with subject "Re: your draft" body "Looks good, no changes needed." → archive or notify_only depending on tone (no further action requested).
- TA: "Can you confirm you'll attend office hours?" → draft_reply (direct ask).
- Scholarship office: "Congratulations — you've been awarded the X scholarship." → notify_only (one-way good news, no reply required).

Glass-box transparency is a hard product requirement. Reasoning bullets MUST cite which fanout source informed each conclusion using the per-source tags in the user content (mistake-N, syllabus-N, calendar-N, email-N). Cite at least one source when any are present; ungrounded claims are unacceptable. Reasoning is ALWAYS in English regardless of the email's language; it's an internal transparency string surfaced in a debug panel, not user-facing prose.`;

const DEEP_PASS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "draft_reply",
        "archive",
        "snooze",
        "no_op",
        "ask_clarifying",
        "notify_only",
      ],
    },
    reasoning: { type: "string", minLength: 1, maxLength: 1500 },
  },
  required: ["action", "reasoning"],
} as const;

export async function runDeepPass(
  input: DeepPassInput
): Promise<DeepPassResult> {
  return Sentry.startSpan(
    {
      name: "email.l2.deep_pass",
      op: "gen_ai.classify",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.task_type": "email_classify_deep",
        "steadii.retrieval.returned": input.similarEmails.length,
      },
    },
    async () => {
      const model = selectModel("email_classify_deep");
      const userContent = buildUserContent(input);

      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "deep_pass",
            strict: true,
            schema: DEEP_PASS_JSON_SCHEMA,
          },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "email_classify_deep",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
            ?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const parsed = parseDeepPassOutput(
        resp.choices[0]?.message?.content ?? "{}"
      );
      const retrievalProvenance = buildProvenance(input);

      return {
        action: parsed.action,
        reasoning: parsed.reasoning,
        retrievalProvenance,
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDeepPassOutput(raw: string): {
  action: DeepAction;
  reasoning: string;
} {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const validActions: DeepAction[] = [
    "draft_reply",
    "archive",
    "snooze",
    "no_op",
    "ask_clarifying",
    "notify_only",
  ];
  const action: DeepAction = validActions.includes(o.action as DeepAction)
    ? (o.action as DeepAction)
    : "ask_clarifying"; // safety default: surface to user, don't silently archive
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning
      : "Model output was unparseable; deferring to user review.";
  return { action, reasoning };
}

function buildUserContent(input: DeepPassInput): string {
  const parts: string[] = [];
  parts.push("=== Current email ===");
  parts.push(`From: ${input.senderEmail} (${input.senderDomain})`);
  if (input.senderRole) parts.push(`Sender role: ${input.senderRole}`);
  parts.push(`Subject: ${input.subject ?? "(none)"}`);
  parts.push(`Body: ${(input.bodySnippet ?? input.snippet ?? "").slice(0, 2000)}`);

  parts.push("\n=== Risk-pass output ===");
  parts.push(`Tier: ${input.riskPass.riskTier} (confidence ${input.riskPass.confidence.toFixed(2)})`);
  parts.push(`Reasoning: ${input.riskPass.reasoning}`);

  if (input.threadRecentMessages.length > 0) {
    parts.push("\n=== Last messages in thread (oldest first) ===");
    for (const m of input.threadRecentMessages) {
      parts.push(`- From ${m.sender}: ${m.snippet.slice(0, 400)}`);
    }
  }

  if (input.fanout) {
    parts.push("");
    parts.push(buildFanoutContextBlocks(input.fanout, "deep"));
  }

  const feedbackBlock = formatRecentFeedbackBlock(input.recentFeedback);
  if (feedbackBlock) {
    parts.push("");
    parts.push(feedbackBlock);
  }

  parts.push(
    `\n=== Retrieved similar emails (top ${input.similarEmails.length} of ${input.totalCandidates}) ===`
  );
  if (input.similarEmails.length === 0) {
    parts.push("(none — user's corpus is new or no semantic matches)");
  } else {
    input.similarEmails.forEach((e, i) => {
      parts.push(
        `email-${i + 1}: [sim=${e.similarity.toFixed(
          2
        )}] ${e.senderEmail} — ${e.subject ?? "(no subject)"} — ${
          (e.snippet ?? "").slice(0, 160)
        }`
      );
    });
  }

  return parts.join("\n");
}

// polish-7 — collapses the per-row feedback set into a short, model-
// readable block. Skipped entirely (returns null) when no rows exist so
// we don't waste tokens on "no feedback yet" filler. Format mirrors the
// fanout blocks (=== Header ===, then bullet rows) for consistency.
function formatRecentFeedbackBlock(
  summary: RecentFeedbackSummary | null | undefined
): string | null {
  if (!summary || summary.totalRows === 0) return null;
  const lines: string[] = [];
  lines.push(
    `=== Recent feedback from this student for this ${summary.scope} (last ${summary.windowDays} days) ===`
  );
  for (const [proposed, responses] of Object.entries(summary.proposedCounts)) {
    for (const [response, count] of Object.entries(responses)) {
      if (count <= 0) continue;
      lines.push(
        `- ${count}× the agent proposed ${proposed}, the student ${response}`
      );
    }
  }
  lines.push(
    "Use this signal to bias toward the student's revealed preference. Repeated dismissal of drafts from this sender is strong evidence to prefer notify_only or archive over draft_reply."
  );
  return lines.join("\n");
}

export function buildProvenance(
  input: Pick<DeepPassInput, "similarEmails" | "totalCandidates" | "fanout">
): RetrievalProvenance {
  const sources: RetrievalProvenance["sources"] = [];
  const fanout = input.fanout ?? null;

  if (fanout) {
    for (const m of fanout.mistakes) {
      sources.push({
        type: "mistake" as const,
        id: m.mistakeId,
        classId: m.classId,
        snippet: (m.bodySnippet || m.title).slice(0, 400),
      });
    }
    for (const s of fanout.syllabusChunks) {
      sources.push({
        type: "syllabus" as const,
        id: s.chunkId,
        syllabusId: s.syllabusId,
        classId: s.classId,
        similarity: s.similarity,
        snippet: s.chunkText.slice(0, 400),
      });
    }
    for (const e of fanout.calendar.events) {
      sources.push({
        type: "calendar" as const,
        id: `event:${e.start}:${e.title}`,
        kind: "event" as const,
        title: e.title,
        start: e.start,
        end: e.end,
      });
    }
    for (const t of fanout.calendar.tasks) {
      sources.push({
        type: "calendar" as const,
        id: `task:${t.due}:${t.title}`,
        kind: "task" as const,
        title: t.title,
        start: t.due,
        end: null,
      });
    }
    for (const a of fanout.calendar.assignments) {
      sources.push({
        type: "calendar" as const,
        id: `assignment:${a.id}`,
        kind: "assignment" as const,
        title: a.title,
        start: a.due,
        end: null,
      });
    }
  }

  for (const e of input.similarEmails) {
    sources.push({
      type: "email" as const,
      id: e.inboxItemId,
      similarity: e.similarity,
      snippet: (e.snippet ?? e.subject ?? "").slice(0, 200),
    });
  }

  return {
    sources,
    total_candidates: input.totalCandidates,
    returned: input.similarEmails.length,
    classBinding: fanout
      ? {
          classId: fanout.classBinding.classId,
          className: fanout.classBinding.className,
          classCode: fanout.classBinding.classCode,
          method: fanout.classBinding.method,
          confidence: fanout.classBinding.confidence,
        }
      : null,
    fanoutCounts: fanout
      ? {
          mistakes: fanout.mistakes.length,
          syllabus: fanout.syllabusChunks.length,
          emails: fanout.similarEmails.length,
          calendar:
            fanout.calendar.events.length +
            fanout.calendar.tasks.length +
            fanout.calendar.assignments.length,
        }
      : null,
    fanoutTimings: fanout
      ? {
          mistakes: fanout.timings.mistakes,
          syllabus: fanout.timings.syllabus,
          emails: fanout.timings.emails,
          calendar: fanout.timings.calendar,
          total: fanout.timings.total,
        }
      : null,
  };
}
