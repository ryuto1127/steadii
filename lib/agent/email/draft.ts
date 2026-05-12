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
  // legacy calendar-only block and adds class binding + sender history +
  // syllabus blocks.
  fanout?: FanoutResult | null;
  // engineer-38 — one-line writing-voice description ("Gen-Z Vancouver
  // student writing concise EN/JA mix; signs off with name only.").
  // Pulled from users.preferences.voiceProfile by the orchestrator and
  // injected as a single line near the top of the prompt. Optional so
  // legacy callers keep working with no prompt-shape change.
  voiceProfile?: string | null;
  // engineer-38 — short sentences extracted by the style-learner cron
  // from past edit deltas ("Use 確認 instead of ご確認."). Listed under
  // "Your writing-style preferences" so the model treats them as soft
  // rules. Empty array = no learner output yet.
  writingStyleRules?: string[];
  // Optional — if null, the model picks from the sender's To/From.
  userName: string | null;
  userEmail: string | null;
  // engineer-45 — student's IANA timezone, threaded so the prompt can
  // tell the model whether the dual-TZ rendering rule applies. Optional
  // for backwards-compat with tests / legacy callers; null falls back
  // to "TZ unknown" and the model can't dual-render (acceptable degrade).
  userTimezone?: string | null;
  // engineer-45 — inferred sender timezone from the domain heuristic
  // (.co.jp → Asia/Tokyo, etc.). Null when ambiguous — the model then
  // skips dual-rendering since it can't pick a second side. Including
  // this in the prompt is cheaper than running infer_sender_timezone
  // on every medium-tier draft.
  senderTimezone?: string | null;
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

Fanout grounding (when "Class binding" / "Contact persona" / "How you usually reply to this sender" / "Relevant syllabus sections" / "Calendar" / "Reference: similar past emails" blocks are present):
- Use the per-source tags (self-N, syllabus-N, calendar-N, email-N) to ground tone, content, and any factual claim.
- The "How you usually reply to this sender" block (self-N) is the strongest tone/register signal: match the user's prior reply tone, length, and register to this same sender. Do NOT echo phrases verbatim — use them as a model for register, not a template.
- The "Contact persona" block (when present) carries the relationship label and learned facts about this contact. Use it to set tone + register and to interpret the request. Match the persona's relationship label — formal for "instructor", casual for "Mom", etc. The sender-history block, when present, OVERRIDES the persona for sender-specific style. Do NOT echo facts from the persona back to the contact unless the user asked — the persona is internal context.
- If a "Your writing voice" block is present, treat it as the cold-start anchor: register, language mix, length, signature pattern. The sender-history block, when present, OVERRIDES the voice block for sender-specific style.
- If a "Your writing-style preferences" block is present, treat each bullet as a soft rule learned from the user's past edits. Apply where natural; don't force them in if a rule clearly doesn't fit the current email.
- "Reasoning" MUST cite which fanout source(s) informed each conclusion, using those tags. Glass-box transparency is non-negotiable; ungrounded factual claims are unacceptable.

Language rules — keep these distinct:
- 'subject' and 'body' MUST match the incoming email's language (the student's working language). Japanese in → Japanese reply; English in → English reply.
- 'reasoning' is ALWAYS in English regardless of the email's language. It's an internal explanation surfaced in a debug/transparency panel, not user-facing prose. Mixing languages here makes the panel inconsistent across drafts.

DRAFT BODY TZ DISPLAY (when the user context block names a sender timezone different from the student's timezone):
- Whenever the body proposes / accepts / references a specific time slot AND the student's timezone differs from the sender's timezone, render EVERY slot in BOTH timezones, e.g. "5月15日(木) 10:00 JST / 5月14日(水) 18:00 PT". Never show only one side.
- Use the pre-formatted slot strings from the "Slot timezones (use verbatim)" block when present — they are already DST-correct. Don't recompute the offsets yourself.
- This rule is non-negotiable: students mis-read JST-only slots as their own local time and miss meetings. The dual-rendering eliminates the ambiguity.
- When both timezones are the same (sender is in the student's TZ or vice versa), do NOT dual-render — that's noise.`;

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

  // engineer-38 — voice profile + writing-style rules render BEFORE the
  // email itself. Voice = cold-start anchor (always-on identity). Style
  // rules = soft per-user prefs learned from edit deltas. Sender-history
  // (inside the fanout block below) takes precedence over both for
  // sender-specific register; the prompt's grounding rules above tell
  // the model exactly how to reconcile.
  const voice = input.voiceProfile?.trim();
  if (voice) {
    parts.push("=== Your writing voice ===");
    parts.push(voice);
    parts.push("");
  }
  const styleRules = (input.writingStyleRules ?? [])
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (styleRules.length > 0) {
    parts.push(
      "=== Your writing-style preferences (learned from past edits) ==="
    );
    for (const r of styleRules) parts.push(`- ${r}`);
    parts.push("");
  }

  parts.push("=== Email you're replying to ===");
  parts.push(
    `From: ${input.senderName ? `${input.senderName} <${input.senderEmail}>` : input.senderEmail}`
  );
  if (input.senderRole) parts.push(`Sender role: ${input.senderRole}`);
  parts.push(`Subject: ${input.subject ?? "(none)"}`);
  parts.push(`Body: ${(input.bodySnippet ?? input.snippet ?? "").slice(0, 8000)}`);
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

  // engineer-45 — explicit TZ-pair block so the model knows when the
  // DRAFT BODY TZ DISPLAY rule applies. When both timezones are
  // present and different, the model must dual-render every slot. When
  // either is missing or they're equal, the rule is skipped.
  const userTz = input.userTimezone?.trim();
  const senderTz = input.senderTimezone?.trim();
  if (userTz || senderTz) {
    parts.push("\n=== Timezones ===");
    parts.push(`Student timezone: ${userTz ?? "(unknown)"}`);
    parts.push(`Sender timezone: ${senderTz ?? "(unknown — do not dual-render)"}`);
    if (userTz && senderTz && userTz !== senderTz) {
      parts.push(
        "TZ pair differs — apply DRAFT BODY TZ DISPLAY rule: every time slot in the body MUST appear in BOTH timezones (sender side / student side)."
      );
    } else if (userTz && senderTz && userTz === senderTz) {
      parts.push(
        "TZ pair matches — single-render slots in the shared TZ. Do not dual-render."
      );
    }
  }

  return parts.join("\n");
}
