import "server-only";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import { getGmailForUser } from "@/lib/integrations/google/gmail";
import {
  extractEmailBody,
  type ExtractedBody,
} from "@/lib/agent/email/body-extract";
import { getHeader, parseAddress } from "@/lib/integrations/google/gmail-fetch";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import type { ToolExecutor } from "./types";

// 2026-05-08 — chat agent thread summarizer. Distills a multi-message
// thread (incoming + outgoing, full Gmail thread) into one paragraph
// + key points. Pluck from Shortwave / Apple Intelligence's "summarize
// this thread" feature; works against Gmail's threads.get so we get the
// complete message graph in one API call regardless of whether each
// message was Steadii-mediated.
//
// Either `inboxItemId` or `threadExternalId` is sufficient — the tool
// resolves whichever wasn't supplied. Returned summary is bounded so
// long threads don't blow the chat context window.

const SUMMARY_MAX_BODY_CHARS_PER_MSG = 1500;
const SUMMARY_MAX_INPUT_CHARS = 12_000;
const SUMMARY_MAX_KEY_POINTS = 5;

const args = z
  .object({
    inboxItemId: z.string().uuid().optional(),
    threadExternalId: z.string().min(1).optional(),
  })
  .refine(
    (a) =>
      typeof a.inboxItemId === "string" ||
      typeof a.threadExternalId === "string",
    { message: "Provide either inboxItemId or threadExternalId" }
  );

export type EmailThreadSummary = {
  threadExternalId: string;
  messageCount: number;
  participants: string[];
  firstSentAt: string | null;
  lastSentAt: string | null;
  overview: string;
  keyPoints: string[];
};

export const emailThreadSummarize: ToolExecutor<
  z.infer<typeof args>,
  EmailThreadSummary
> = {
  schema: {
    name: "email_thread_summarize",
    description:
      "Summarize an entire email thread (all incoming + outgoing messages) into one-line overview + up to 5 key points + participant list. Use when the user asks for the gist of a long thread, when they want to know decisions/action items across many messages, or before writing a reply that needs the full context. Pass `inboxItemId` (preferred — most chat references an inbox row) OR `threadExternalId` directly. Eager — call without confirmation when the user references a thread by sender/subject and the message count is plausibly >2.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        inboxItemId: {
          type: "string",
          description:
            "Steadii inbox_item id. The tool resolves the threadExternalId from this row.",
        },
        threadExternalId: {
          type: "string",
          description:
            "Gmail thread id (RFC822-style). Use directly when the chat already has a thread id (rare).",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs ?? {});
    return Sentry.startSpan(
      {
        name: "agent.tool.email_thread_summarize",
        op: "gen_ai.generate",
        attributes: {
          "steadii.user_id": ctx.userId,
        },
      },
      async () => {
        const threadExternalId = await resolveThreadId(ctx.userId, parsed);
        if (!threadExternalId) {
          throw new Error("Could not resolve thread id");
        }

        const messages = await fetchThreadMessages(ctx.userId, threadExternalId);
        if (messages.length === 0) {
          throw new Error("Thread has no messages or is not accessible");
        }

        const corpus = buildSummarizationCorpus(messages);
        const { overview, keyPoints } = await summarize(corpus);

        const participants = collectParticipants(messages);
        const sentDates = messages
          .map((m) => m.sentAt)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => a.getTime() - b.getTime());

        return {
          threadExternalId,
          messageCount: messages.length,
          participants,
          firstSentAt: sentDates[0]?.toISOString() ?? null,
          lastSentAt: sentDates[sentDates.length - 1]?.toISOString() ?? null,
          overview,
          keyPoints,
        };
      }
    );
  },
};

async function resolveThreadId(
  userId: string,
  args: { inboxItemId?: string; threadExternalId?: string }
): Promise<string | null> {
  if (args.threadExternalId) return args.threadExternalId;
  if (!args.inboxItemId) return null;
  const [row] = await db
    .select({ threadExternalId: inboxItems.threadExternalId })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, args.inboxItemId),
        eq(inboxItems.userId, userId),
        isNull(inboxItems.deletedAt)
      )
    )
    .limit(1);
  return row?.threadExternalId ?? null;
}

type ThreadMessage = {
  messageId: string;
  fromName: string | null;
  fromEmail: string;
  isFromUser: boolean;
  subject: string | null;
  body: string;
  sentAt: Date | null;
};

async function fetchThreadMessages(
  userId: string,
  threadId: string
): Promise<ThreadMessage[]> {
  const gmail = await getGmailForUser(userId);
  // Gmail's `users.threads.get(format: "full")` returns the full
  // message graph in one call — no per-message round trips needed.
  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  const userEmail = await fetchOwnEmail(userId).catch(() => null);
  const out: ThreadMessage[] = [];
  for (const m of res.data.messages ?? []) {
    if (!m.id) continue;
    const fromHeader = getHeader(m, "From");
    const from = parseAddress(fromHeader);
    const subject = getHeader(m, "Subject");
    const extracted: ExtractedBody = extractEmailBody(m);
    const body = (extracted.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SUMMARY_MAX_BODY_CHARS_PER_MSG);
    const sentAt = parseSentAt(m.internalDate);
    out.push({
      messageId: m.id,
      fromName: from.name,
      fromEmail: from.email,
      isFromUser:
        userEmail !== null &&
        from.email.toLowerCase() === userEmail.toLowerCase(),
      subject,
      body,
      sentAt,
    });
  }
  return out;
}

async function fetchOwnEmail(userId: string): Promise<string | null> {
  // Gmail profile.getUserId returns the address Gmail authenticated as
  // — that's the user's "me" identity. Used to mark which thread
  // messages came FROM the user vs the other side. Cached implicitly
  // by getGmailForUser per-call.
  try {
    const gmail = await getGmailForUser(userId);
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? null;
  } catch {
    return null;
  }
}

function buildSummarizationCorpus(messages: ThreadMessage[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    const date = m.sentAt ? m.sentAt.toISOString().slice(0, 10) : "??";
    const sender = m.isFromUser
      ? "(user)"
      : m.fromName
      ? `${m.fromName} <${m.fromEmail}>`
      : m.fromEmail;
    const subj = m.subject ? ` Subject: ${m.subject}` : "";
    const block = `[${date}] ${sender}${subj}\n${m.body}\n`;
    if (total + block.length > SUMMARY_MAX_INPUT_CHARS) break;
    lines.push(block);
    total += block.length;
  }
  return lines.join("\n---\n");
}

function collectParticipants(messages: ThreadMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (!m.fromEmail) continue;
    const key = m.fromEmail.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail);
  }
  return out;
}

function parseSentAt(internalDate: string | null | undefined): Date | null {
  if (!internalDate) return null;
  const ms = Number(internalDate);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

const SYSTEM_PROMPT = `You summarize an email thread for the user (a university student). Output JSON only:
{
  "overview": "ONE sentence (max 25 words) capturing what the thread is about and where it stands.",
  "keyPoints": ["up to 5 bullets covering decisions made, requests pending, and action items the user owns or expects"]
}

Rules:
- Write in the language the thread is in (mix EN/JA naturally if the thread is bilingual).
- "(user)" lines mean the student's own outgoing message.
- Skip pleasantries; surface only points the user needs to remember.
- Do not invent facts; if a date or name isn't in the thread, omit it.
- Output raw JSON, no markdown fences.`;

async function summarize(corpus: string): Promise<{
  overview: string;
  keyPoints: string[];
}> {
  const model = selectModel("tool_call");
  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: corpus },
    ],
    response_format: { type: "json_object" },
    max_tokens: 600,
  });
  const raw = resp.choices[0]?.message?.content ?? "{}";
  let parsed: { overview?: unknown; keyPoints?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const overview =
    typeof parsed.overview === "string" && parsed.overview.length > 0
      ? parsed.overview.slice(0, 300)
      : "(summary unavailable)";
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .slice(0, SUMMARY_MAX_KEY_POINTS)
    : [];
  return { overview, keyPoints };
}

export const EMAIL_THREAD_TOOLS = [emailThreadSummarize];
