import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { SimilarEmail } from "./retrieval";

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
  // Optional — if null, the model picks from the sender's To/From.
  userName: string | null;
  userEmail: string | null;
};

export type DraftResult = {
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  inReplyTo: string | null;
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

Output JSON with: subject (usually 'Re: <original subject>'), body, to (list), cc (list; usually empty), in_reply_to (string or null; echo the incoming In-Reply-To header).`;

const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", minLength: 1, maxLength: 5000 },
    to: { type: "array", items: { type: "string" } },
    cc: { type: "array", items: { type: "string" } },
    in_reply_to: { type: ["string", "null"] },
  },
  required: ["subject", "body", "to", "cc", "in_reply_to"],
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
        subject: parsed.subject,
        body: parsed.body,
        to: parsed.to,
        cc: parsed.cc,
        inReplyTo: parsed.inReplyTo ?? input.inReplyTo,
        usageId: rec.usageId,
      };
    }
  );
}

export function parseDraftOutput(raw: string): {
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  inReplyTo: string | null;
} {
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
  return { subject, body, to, cc, inReplyTo };
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

  if (input.similarEmails.length > 0) {
    parts.push(
      `\n=== Reference: similar past emails from the user's inbox (${input.similarEmails.length}) ===`
    );
    parts.push(
      "(For tone and style only. Do not fabricate quotes or commit to anything from these.)"
    );
    input.similarEmails.forEach((e, i) => {
      parts.push(
        `${i + 1}. [sim=${e.similarity.toFixed(2)}] ${e.senderEmail} — ${
          e.subject ?? "(no subject)"
        } — ${(e.snippet ?? "").slice(0, 180)}`
      );
    });
  }

  if (input.userEmail) {
    parts.push(`\n=== Student ===`);
    parts.push(`Email: ${input.userEmail}`);
    if (input.userName) parts.push(`Name: ${input.userName}`);
  }

  return parts.join("\n");
}
