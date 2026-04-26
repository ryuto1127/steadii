import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { SimilarEmail } from "./retrieval";
import type { DraftCalendarEvent } from "@/lib/integrations/google/calendar";
import {
  buildFanoutContextBlocks,
  type FanoutResult,
} from "./fanout-prompt";

export type DraftInput = {
  userId: string;
  senderEmail: string;
  senderName: string | null;
  senderRole: string | null;
  subject: string | null;
  snippet: string | null;
  bodySnippet: string | null;
  inReplyTo: string | null;
  threadRecentMessages: Array<{ sender: string; snippet: string }>;
  // High-risk items get full retrieved-similar context; medium risk passes
  // an empty array.
  similarEmails: SimilarEmail[];
  // Upcoming Google Calendar events in the user's schedule, used to ground
  // availability-related replies in real data instead of asking back. Empty
  // if calendar isn't connected — the prompt then falls through to
  // "ask before committing" behavior.
  //
  // Phase 7 W1: when `fanout` is provided, the prompt prefers its
  // `calendar` block (which includes Google Tasks). `calendarEvents` stays
  // for backwards-compat with callers that haven't moved to fanout yet.
  calendarEvents: DraftCalendarEvent[];
  // Phase 7 W1 — multi-source fanout context. When set, replaces the
  // legacy calendar-only block and adds class binding + mistakes +
  // syllabus blocks.
  fanout?: FanoutResult | null;
  // Optional — if null, the model picks from the sender's To/From.
  userName: string | null;
  userEmail: string | null;
};

// `kind` lets the LLM escalate from "I can answer this" to "I need to ask
// back first" inside a single call, instead of forcing the orchestrator to
// guess. When kind="clarify", `body` IS the clarifying question to send
// back to the original sender — we still send an email, just one that
// asks instead of answers. `reasoning` explains the choice for the
// glass-box "Why this draft" panel.
export type DraftResult = {
  kind: "draft" | "clarify";
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  inReplyTo: string | null;
  reasoning: string;
  usageId: string | null;
};

const SYSTEM_PROMPT = `You are Steadii's email draft writer for a university student. You compose a reply the student will review before sending.

Tone: match the sender's register (formal professors get formal replies; peers get casual). Default to the student's working language — if the incoming email is Japanese, reply in Japanese.

Length: concise. One-paragraph replies for routine items; short multi-paragraph for substantive asks. Never exceed ~200 words unless the thread is genuinely complex.

Do NOT:
- make commitments the student hasn't authorized (grades, meetings, sending files);
- invent facts not in the context;
- fabricate quotes from past emails;
- sign off with the student's name — leave the signature blank; the student will add it.

Choose 'kind':
- "draft" — the request is unambiguous and you can answer it on the student's behalf without guessing.
- "clarify" — there is a real ambiguity that a thoughtful human would ask back about before answering. In this case 'body' is the clarifying question(s) you'd send to the original sender, polite and specific.

Pick "clarify" when ANY of these hold:
- Subject and body conflict (e.g. subject says "Monday" but body says "Thursday").
- A critical detail (date, time, location, who, what assignment, which class) is missing or ambiguous AND the student can't reasonably infer it from context (including the calendar block below).
- The sender is asking the student a yes/no decision that depends on preferences only the student knows (NOT availability — see calendar rule below).
- The sender's request implies multiple possible interpretations and choosing wrong has a non-trivial cost (missed meeting, wrong file sent, etc.).

Calendar grounding (when the "Calendar" block is non-empty below):
- If the sender proposes a specific time AND that time has no conflicting event, draft an acceptance — don't ask back. Cite the slot's freeness in 'reasoning'.
- If the proposed time DOES conflict with an event, draft a polite reply that names the conflict and proposes a nearby free slot (or asks the sender to pick from 1-2 alternative free times you can see). Don't reveal the title of the conflicting event (it may be private) — just say "I have something already at that time."
- "Free this week?" / open-ended availability questions: kind="draft" suggesting one or two specific free slots from the calendar, not "let me check and get back."
- If calendar is empty (user hasn't connected it OR genuinely has nothing), fall back to clarify on availability questions as before.

Default to "draft" when there is one obviously-correct interpretation. Don't ask back for routine acknowledgments or single-fact replies.

Always populate every field. For "clarify": subject is still 'Re: <original>', body is the question(s), to/cc target the original sender as if you were drafting a reply (because you are — it's an email, just one that asks). 'reasoning' is one or two short sentences explaining why you picked this kind.

Fanout grounding (when "Class binding" / "Relevant past mistakes" / "Relevant syllabus sections" / "Calendar" / "Reference: similar past emails" blocks are present):
- Use the per-source tags (mistake-N, syllabus-N, calendar-N, email-N) to ground tone, content, and any factual claim. If the syllabus says late submissions lose 10%, cite syllabus-N. If a past mistake shows you've already covered this exact topic with this prof, cite mistake-N.
- "Reasoning" MUST cite which fanout source(s) informed each conclusion, using those tags. Glass-box transparency is non-negotiable; ungrounded factual claims are unacceptable.

Language rules — keep these distinct:
- 'subject' and 'body' MUST match the incoming email's language (the student's working language). Japanese in → Japanese reply; English in → English reply.
- 'reasoning' is ALWAYS in English regardless of the email's language. It's an internal explanation surfaced in a debug/transparency panel, not user-facing prose. Mixing languages here makes the panel inconsistent across drafts.`;

const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["draft", "clarify"] },
    subject: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", minLength: 1, maxLength: 5000 },
    to: { type: "array", items: { type: "string" } },
    cc: { type: "array", items: { type: "string" } },
    in_reply_to: { type: ["string", "null"] },
    reasoning: { type: "string", minLength: 1, maxLength: 600 },
  },
  required: [
    "kind",
    "subject",
    "body",
    "to",
    "cc",
    "in_reply_to",
    "reasoning",
  ],
} as const;

export async function runDraft(input: DraftInput): Promise<DraftResult> {
  return Sentry.startSpan(
    {
      name: "email.l2.draft",
      op: "gen_ai.generate",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.task_type": "email_draft",
        "steadii.retrieval.returned": input.similarEmails.length,
      },
    },
    async () => {
      const model = selectModel("email_draft");
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
            name: "email_draft",
            strict: true,
            schema: DRAFT_JSON_SCHEMA,
          },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "email_draft",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
            ?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const parsed = parseDraftOutput(
        resp.choices[0]?.message?.content ?? "{}"
      );

      return {
        kind: parsed.kind,
        subject: parsed.subject,
        body: parsed.body,
        to: parsed.to,
        cc: parsed.cc,
        inReplyTo: parsed.inReplyTo ?? input.inReplyTo,
        reasoning: parsed.reasoning,
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDraftOutput(raw: string): {
  kind: "draft" | "clarify";
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  inReplyTo: string | null;
  reasoning: string;
} {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  // Default to "draft" on any unparseable kind so we don't accidentally
  // dispatch a clarify when the model fell over — surfacing a draft for
  // user review is the safer side of the failure mode.
  const kind: "draft" | "clarify" =
    o.kind === "clarify" ? "clarify" : "draft";
  const subject =
    typeof o.subject === "string" && o.subject.trim().length > 0
      ? o.subject
      : "(no subject)";
  const body =
    typeof o.body === "string" && o.body.trim().length > 0
      ? o.body
      : "(draft failed to generate)";
  const to = Array.isArray(o.to)
    ? (o.to as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const cc = Array.isArray(o.cc)
    ? (o.cc as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const inReplyTo =
    typeof o.in_reply_to === "string" ? o.in_reply_to : null;
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning
      : "Draft generated without explicit reasoning.";
  return { kind, subject, body, to, cc, inReplyTo, reasoning };
}

function buildUserContent(input: DraftInput): string {
  const parts: string[] = [];
  parts.push("=== Email you're replying to ===");
  parts.push(
    `From: ${input.senderName ? `${input.senderName} <${input.senderEmail}>` : input.senderEmail}`
  );
  if (input.senderRole) parts.push(`Sender role: ${input.senderRole}`);
  parts.push(`Subject: ${input.subject ?? "(none)"}`);
  parts.push(`Body: ${(input.bodySnippet ?? input.snippet ?? "").slice(0, 2500)}`);
  if (input.inReplyTo) parts.push(`In-Reply-To: ${input.inReplyTo}`);

  if (input.threadRecentMessages.length > 0) {
    parts.push("\n=== Prior thread messages (oldest first) ===");
    for (const m of input.threadRecentMessages) {
      parts.push(`- From ${m.sender}: ${m.snippet.slice(0, 500)}`);
    }
  }

  // Phase 7 W1 — fanout block (class binding + mistakes + syllabus +
  // calendar). When fanout is present we render it BEFORE the similar-
  // emails reference so structured grounding takes precedence over
  // tone-anchoring. When absent we fall back to the legacy calendar-only
  // block at the end so callers that haven't migrated still produce a
  // working prompt.
  if (input.fanout) {
    parts.push("");
    parts.push(buildFanoutContextBlocks(input.fanout, "draft"));
  }

  if (input.similarEmails.length > 0) {
    parts.push(
      `\n=== Reference: similar past emails from the user's inbox (${input.similarEmails.length}) ===`
    );
    parts.push(
      "(For tone and style only. Do not fabricate quotes or commit to anything from these.)"
    );
    input.similarEmails.forEach((e, i) => {
      parts.push(
        `email-${i + 1}: [sim=${e.similarity.toFixed(2)}] ${e.senderEmail} — ${
          e.subject ?? "(no subject)"
        } — ${(e.snippet ?? "").slice(0, 180)}`
      );
    });
  }

  // Legacy calendar block — only emit when fanout wasn't supplied (the
  // fanout's calendar block already covers events + tasks together).
  if (!input.fanout) {
    parts.push("\n=== Calendar (next 7 days) ===");
    if (input.calendarEvents.length === 0) {
      parts.push(
        "(empty — calendar not connected or genuinely no events. Treat availability questions as " +
          "unknown.)"
      );
    } else {
      input.calendarEvents.forEach((e, i) => {
        const where = e.location ? ` @ ${e.location}` : "";
        parts.push(`calendar-${i + 1}: ${e.start} → ${e.end} :: ${e.title}${where}`);
      });
    }
  }

  if (input.userEmail) {
    parts.push(`\n=== Student ===`);
    parts.push(`Email: ${input.userEmail}`);
    if (input.userName) parts.push(`Name: ${input.userName}`);
  }

  return parts.join("\n");
}
