import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type {
  ExtractedActionItem,
  RetrievalProvenance,
} from "@/lib/db/schema";
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
  // 2026-05-06 — user's app locale ("en" / "ja"). Steers the reasoning
  // string the model produces so the inbox-detail draft-details panel
  // (post PR #167) shows JP reasoning to JP users instead of English.
  // Optional / "en" default for back-compat with callers that don't
  // thread the locale.
  locale?: "en" | "ja";
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
  // engineer-39 — structured to-dos the model extracted from the email.
  // Persisted on agent_drafts.extracted_action_items; the inbox detail
  // page surfaces items >= MIN_ACTION_ITEM_CONFIDENCE in the
  // DraftDetailsPanel under a collapsible "N action items detected"
  // section. Empty for non-draft_reply actions and for thin emails the
  // model couldn't extract anything from.
  actionItems: ExtractedActionItem[];
  usageId: string | null;
};

// engineer-39 — UI floor for surfacing extracted items. The model is
// instructed to emit only "high confidence" items but the schema requires
// a numeric value; the UI still self-gates so a future prompt change
// can't quietly fill the panel with low-signal noise.
export const MIN_ACTION_ITEM_CONFIDENCE = 0.6;

const SYSTEM_PROMPT = `You are Steadii's deep classifier for high-risk emails. You receive:
- the email envelope + snippet
- the cheap risk-pass output (tier + its reasoning)
- a multi-source fanout context: class binding + how the user usually replies to this sender (self-N) + relevant syllabus chunks + upcoming calendar events/tasks
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

When proposing the action, reuse tone / register / phrase patterns from how the user has historically replied to this same sender (self-N). The "How you usually reply to this sender" block is the single strongest signal for register; treat it as ground truth for what the user wants to send.

When a "Contact persona" block is present, use it to set tone + register and to interpret the request (e.g. a relationship label of "MAT223 instructor" pushes formal-academic; "Mom" pushes casual). Don't echo facts from the persona block back to the contact unless the user explicitly asked — the persona is internal context, not content for the reply.

Glass-box transparency is a hard product requirement. Reasoning bullets MUST cite which fanout source informed each conclusion using the per-source tags in the user content (self-N, syllabus-N, calendar-N, email-N). Cite at least one source when any are present; ungrounded claims are unacceptable.

Reasoning language: write reasoning in the user's app locale specified in the user message ("Reasoning language: en" → write English; "Reasoning language: ja" → write Japanese). The reasoning is surfaced in the inbox-detail draft-details panel (collapsed-by-default, but still user-visible), so localization matters. Default to English when no language hint is present.

After your reasoning, populate "actionItems" with concrete obligations this email creates for the student — discrete to-dos with optional due dates. Examples of valid action items:
- "Submit photo ID to registrar" (due 2026-05-15)
- "Reply to professor with availability for Thursday" (no due date)
- "Pay $250 enrollment deposit" (due 2026-06-01)
- "Bring signed waiver to first lecture"

Do NOT extract:
- vague invitations ("looks forward to seeing you", "let me know if questions")
- one-way notifications without an obligation ("your grade has been posted", "the syllabus is now available")
- the act of replying itself (the user knows that — the reply is what Steadii is drafting)
- speculation ("might want to check…")

Each item carries a confidence score 0–1. Only emit items with confidence ≥ 0.6; below that, omit them. Title is a short imperative (≤ 80 chars). Due date is YYYY-MM-DD only when the email gives a concrete deadline; otherwise null. Output an empty actionItems array when the email has no concrete obligations.`;

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
    // engineer-39 — concrete to-dos the email creates for the student.
    // See system prompt for inclusion rules. Strict-mode requires
    // dueDate to allow null (use ["string", "null"]). UI floor is 0.6.
    actionItems: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          dueDate: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["title", "dueDate", "confidence"],
      },
    },
  },
  required: ["action", "reasoning", "actionItems"],
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
        actionItems: parsed.actionItems,
        retrievalProvenance,
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDeepPassOutput(raw: string): {
  action: DeepAction;
  reasoning: string;
  actionItems: ExtractedActionItem[];
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
  const actionItems = parseActionItems(o.actionItems);
  return { action, reasoning, actionItems };
}

// engineer-39 — defensive parser. Strict-mode JSON-schema enforces shape
// at the OpenAI side, but we still validate locally because the in-process
// orchestrator code paths don't depend on schema enforcement (a model-side
// regression should still degrade safely to "no items extracted").
function parseActionItems(raw: unknown): ExtractedActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedActionItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title =
      typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
    if (title.length === 0) continue;
    let dueDate: string | null = null;
    if (typeof r.dueDate === "string") {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(r.dueDate.trim());
      if (m) dueDate = m[1];
    }
    const confidenceRaw = typeof r.confidence === "number" ? r.confidence : 0;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));
    out.push({ title, dueDate, confidence });
  }
  return out;
}

function buildUserContent(input: DeepPassInput): string {
  const parts: string[] = [];
  parts.push(`Reasoning language: ${input.locale ?? "en"}`);
  parts.push("");
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
    for (const h of fanout.senderHistory) {
      const body = (h.draftBody ?? h.draftSubject ?? "").slice(0, 200);
      sources.push({
        type: "sender_history" as const,
        id: h.draftId,
        sentAt: h.sentAt.toISOString(),
        snippet: body,
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
          senderHistory: fanout.senderHistory.length,
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
          senderHistory: fanout.timings.senderHistory,
          syllabus: fanout.timings.syllabus,
          emails: fanout.timings.emails,
          calendar: fanout.timings.calendar,
          total: fanout.timings.total,
        }
      : null,
  };
}
