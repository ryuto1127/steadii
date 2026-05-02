import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { PreBriefInput, PreBriefResult } from "./types";

// Pre-brief generator. Uses the same chat-tier model as Phase 8 proposal
// generation (gpt-5.4-mini) — the brief is bounded summarisation work, not
// drafting, so the cheaper tier is appropriate. Cost target ~$0.005-0.01
// per brief at typical input sizes (4-6K tokens in, ~200 tokens out).
//
// The prompt is intentionally terse: bullets first, optional markdown
// detail second. The model's `bullets` output drops directly onto the
// queue card; `detail_markdown` powers the per-event detail page.

const SYSTEM_PROMPT = `You are Steadii, the executive assistant for a university student. The student is about to walk into a meeting in ~15 minutes. Produce a short brief that they can read on the way.

Goal: surface only what the student needs to remember for THIS specific meeting. Don't summarize their whole week.

Output two parts:
1. \`bullets\`: 3 to 6 short, scannable lines. Each line is one fact, decision, or open thread the student should walk in remembering. No filler ("nothing to report"), no politeness. Lead with the noun: "Last email from <name> ...", "Open question on ...", "Pending decision: ...", "Deadline this week: ...".
2. \`detail_markdown\`: a slightly longer markdown brief (3-6 paragraphs, headings allowed) for the detail page. This is what the student reads if they want depth — recent thread context, prior commitments, action items left from past meetings.

Rules:
- Match the student's working language. If their existing data (subjects, mistake titles) is mostly Japanese, write in Japanese; otherwise English.
- Cite specifics ("ch.5 §3.4", "5/16 problem set 6", "Prof. Tanaka asked you to pick a chapter") — never vague ("some chapter").
- If a topic is closed, drop it. Don't list resolved items.
- Don't fabricate. If the input has no recent email from an attendee, don't make one up.
- If you genuinely have nothing material, say so — one bullet, "No open threads or pending items with this attendee" — better honest than padded.`;

const PRE_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bullets: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1, maxLength: 240 },
          kind: {
            type: ["string", "null"],
            enum: [
              "email",
              "task",
              "deadline",
              "mistake",
              "syllabus",
              "decision",
              null,
            ],
          },
        },
        required: ["text", "kind"],
      },
    },
    detail_markdown: { type: "string", minLength: 1, maxLength: 4000 },
  },
  required: ["bullets", "detail_markdown"],
} as const;

export async function generatePreBrief(
  input: PreBriefInput
): Promise<PreBriefResult> {
  return Sentry.startSpan(
    {
      name: "pre_brief.generate",
      op: "gen_ai.generate",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.event_id": input.event.id,
      },
    },
    async () => {
      const model = selectModel("proactive_proposal");
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
            name: "pre_brief",
            strict: true,
            schema: PRE_BRIEF_JSON_SCHEMA,
          },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "proactive_proposal",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
            ?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const parsed = parsePreBriefOutput(
        resp.choices[0]?.message?.content ?? "{}"
      );

      return {
        bullets: parsed.bullets,
        detailMarkdown: parsed.detailMarkdown,
        usageId: rec.usageId,
      };
    }
  );
}

export function parsePreBriefOutput(raw: string): {
  bullets: PreBriefResult["bullets"];
  detailMarkdown: string;
} {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const bullets = Array.isArray(o.bullets)
    ? (o.bullets as Array<Record<string, unknown>>)
        .map((b) => ({
          text: typeof b.text === "string" ? b.text : "",
          kind:
            typeof b.kind === "string"
              ? (b.kind as PreBriefResult["bullets"][number]["kind"])
              : undefined,
        }))
        .filter((b) => b.text.trim().length > 0)
    : [];
  const detailMarkdown =
    typeof o.detail_markdown === "string" && o.detail_markdown.trim().length > 0
      ? o.detail_markdown
      : "";
  return { bullets, detailMarkdown };
}

function buildUserContent(input: PreBriefInput): string {
  const parts: string[] = [];
  parts.push("=== Meeting ===");
  parts.push(`Title: ${input.event.title}`);
  parts.push(`Start: ${input.event.startsAt.toISOString()}`);
  if (input.event.location) parts.push(`Location: ${input.event.location}`);
  if (input.event.description)
    parts.push(`Description: ${input.event.description.slice(0, 800)}`);

  parts.push("");
  parts.push("=== Attendees ===");
  if (input.attendees.length === 0) {
    parts.push("(none recorded)");
  } else {
    for (const a of input.attendees) {
      parts.push(`- ${a.name ? `${a.name} <${a.email}>` : a.email}`);
    }
  }

  if (input.classContext) {
    parts.push("");
    parts.push("=== Class context ===");
    parts.push(
      `Class: ${input.classContext.code ? `${input.classContext.code} — ` : ""}${input.classContext.name}`
    );
  }

  parts.push("");
  parts.push("=== Recent emails with attendees (most recent first) ===");
  if (input.recentEmails.length === 0) {
    parts.push("(no recent thread)");
  } else {
    input.recentEmails.slice(0, 10).forEach((e, i) => {
      const sender = e.senderName
        ? `${e.senderName} <${e.senderEmail}>`
        : e.senderEmail;
      parts.push(
        `email-${i + 1}: ${e.receivedAt.toISOString().slice(0, 10)} · ${sender} · ${e.subject ?? "(no subject)"}`
      );
      if (e.snippet) parts.push(`  ${e.snippet.slice(0, 240)}`);
    });
  }

  parts.push("");
  parts.push("=== Upcoming deadlines (next 7 days) ===");
  if (input.upcomingDeadlines.length === 0) {
    parts.push("(none)");
  } else {
    for (const d of input.upcomingDeadlines.slice(0, 8)) {
      parts.push(`- ${d.due.toISOString().slice(0, 10)} :: ${d.title}`);
    }
  }

  parts.push("");
  parts.push("=== Recent mistake notes (last 30 days) ===");
  if (input.recentMistakes.length === 0) {
    parts.push("(none)");
  } else {
    input.recentMistakes.slice(0, 5).forEach((m, i) => {
      parts.push(
        `mistake-${i + 1}: ${m.title}${m.unit ? ` · ${m.unit}` : ""}`
      );
      if (m.bodySnippet) parts.push(`  ${m.bodySnippet.slice(0, 220)}`);
    });
  }

  return parts.join("\n");
}
