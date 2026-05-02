import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type {
  OfficeHoursCandidateSlot,
  OfficeHoursCompiledQuestion,
} from "@/lib/db/schema";

// Wave 3.3 — office-hours email draft generator.
// Produces a polite request email naming the picked slot and the
// compiled question list inline. Same model tier as W1 email draft.

const SYSTEM_PROMPT = `You write a short, polite office-hours request email for a university student.

Inputs include:
- A picked slot (date, time, location).
- A list of pre-compiled questions the student plans to bring.

Rules:
- Open with the prof's salutation in their working language. Japanese profs → 「Tanaka 教授」 etc.; English → "Dear Prof. X" / "Hi Prof X" depending on register.
- One short paragraph naming the picked slot (date, time) and a one-line "would that work for you?" or 同等.
- Inline the compiled question list as a short bulleted list (no more than 5).
- Sign off with the student's first name. No quoted signature lines.
- Stay under 150 words.

Output JSON: { "subject": "...", "body": "..." }.
Subject is short and specific to the class+topic.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", minLength: 1, maxLength: 160 },
    body: { type: "string", minLength: 1, maxLength: 1600 },
  },
  required: ["subject", "body"],
} as const;

export type OfficeHoursDraftInput = {
  userId: string;
  userName: string | null;
  professorName: string | null;
  professorEmail: string | null;
  classCode: string | null;
  className: string | null;
  topic: string | null;
  slot: OfficeHoursCandidateSlot;
  questions: OfficeHoursCompiledQuestion[];
};

export type OfficeHoursDraftResult = {
  subject: string;
  body: string;
  to: string;
  usageId: string | null;
};

export async function generateOfficeHoursDraft(
  input: OfficeHoursDraftInput
): Promise<OfficeHoursDraftResult> {
  return Sentry.startSpan(
    { name: "office_hours.draft", op: "gen_ai.generate" },
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
          json_schema: { name: "office_hours_draft", strict: true, schema: SCHEMA },
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

      const parsed = parseDraft(resp.choices[0]?.message?.content ?? "{}");
      return {
        subject: parsed.subject,
        body: parsed.body,
        to: input.professorEmail ?? "",
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDraft(raw: string): { subject: string; body: string } {
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
      : "Office hours request";
  const body =
    typeof o.body === "string" && o.body.trim().length > 0
      ? o.body
      : "Hi Professor — would the proposed slot work? I'd like to bring a few questions. Thanks.";
  return { subject, body };
}

function buildUserContent(input: OfficeHoursDraftInput): string {
  const lines: string[] = [];
  lines.push(`Class: ${input.classCode ?? "-"} ${input.className ?? ""}`.trim());
  lines.push(
    `Recipient: ${
      input.professorName
        ? `${input.professorName} <${input.professorEmail ?? ""}>`
        : input.professorEmail ?? "(unknown)"
    }`
  );
  if (input.userName) lines.push(`Sender first name: ${input.userName.split(/\s+/)[0]}`);
  if (input.topic) lines.push(`Topic: ${input.topic}`);
  lines.push(
    `Picked slot: ${formatLocalSlot(input.slot)}${
      input.slot.location ? ` @ ${input.slot.location}` : ""
    }`
  );
  if (input.questions.length > 0) {
    lines.push("");
    lines.push("Compiled questions:");
    for (const q of input.questions) lines.push(`- ${q.label}`);
  }
  return lines.join("\n");
}

function formatLocalSlot(slot: OfficeHoursCandidateSlot): string {
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const tFmt = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${tFmt.format(start)}–${tFmt.format(end)}`;
}
