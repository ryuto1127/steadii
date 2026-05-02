import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";

// Wave 3.2 — check-in draft generator.
// When a member goes silent, the user clicks "Draft check-in" on the
// group detail page; we LLM a low-stakes nudge ("hey, just checking in
// on …, no pressure, here's where things stand"). Returns the draft
// body for inline preview; saving / sending is a follow-up step.

const SYSTEM_PROMPT = `You write short, low-stakes group-project check-in emails for a university student. Your goal is to nudge a teammate who's been quiet without sounding nagging or hostile.

Rules:
- Length: 60-120 words.
- Open warmly. Acknowledge that everyone's busy.
- One specific question or ask (not a list of demands).
- Offer concrete next-step assist if helpful ("happy to take the X piece if you're swamped").
- Sign off with the student's first name.
- Match the working language: if recipient name + group context is Japanese, write in Japanese; otherwise English.
- Subject is short and specific to the project.

Output JSON: { "subject": "...", "body": "..." }.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", minLength: 1, maxLength: 160 },
    body: { type: "string", minLength: 1, maxLength: 1600 },
  },
  required: ["subject", "body"],
} as const;

export type CheckInDraftInput = {
  userId: string;
  userName: string | null;
  groupTitle: string;
  className: string | null;
  memberName: string | null;
  memberEmail: string;
  daysSilent: number;
  // Optional context — last few exchanges with the member, if any.
  recentSnippets: string[];
};

export type CheckInDraft = {
  subject: string;
  body: string;
  to: string;
  usageId: string | null;
};

export async function generateCheckInDraft(
  input: CheckInDraftInput
): Promise<CheckInDraft> {
  return Sentry.startSpan(
    { name: "group_checkin.generate", op: "gen_ai.generate" },
    async () => {
      const model = selectModel("email_draft");
      const userMsg = buildUserContent(input);
      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "checkin", strict: true, schema: SCHEMA },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "email_draft",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          })?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const parsed = parse(resp.choices[0]?.message?.content ?? "{}");
      return {
        subject: parsed.subject,
        body: parsed.body,
        to: input.memberEmail,
        usageId: rec.usageId,
      };
    }
  );
}

export function parse(raw: string): { subject: string; body: string } {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const subject =
    typeof o.subject === "string" && o.subject.trim().length > 0
      ? o.subject
      : "Quick check-in";
  const body =
    typeof o.body === "string" && o.body.trim().length > 0
      ? o.body
      : "Hey — just checking in. Let me know how you're doing.";
  return { subject, body };
}

function buildUserContent(input: CheckInDraftInput): string {
  const lines: string[] = [];
  lines.push(`Group project: ${input.groupTitle}`);
  if (input.className) lines.push(`Class: ${input.className}`);
  lines.push(
    `Recipient: ${input.memberName ? `${input.memberName} <${input.memberEmail}>` : input.memberEmail}`
  );
  lines.push(`Days silent: ${input.daysSilent}`);
  if (input.userName) lines.push(`Sender first name: ${input.userName}`);
  if (input.recentSnippets.length > 0) {
    lines.push("");
    lines.push("Recent context (most recent first):");
    input.recentSnippets.slice(0, 3).forEach((s, i) => {
      lines.push(`- ctx-${i + 1}: ${s.slice(0, 240)}`);
    });
  }
  return lines.join("\n");
}
