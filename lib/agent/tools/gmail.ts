import "server-only";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { getGmailForUser } from "@/lib/integrations/google/gmail";
import type { ToolExecutor } from "./types";

// ---------------------------------------------------------------------------
// Gmail draft + send helpers. Two-step flow per memory:
//   1. users.drafts.create — gives us a Gmail draft ID visible in the
//      user's own Gmail UI during the 20s undo window.
//   2. users.drafts.send — promotes the draft to sent; called by the
//      send_queue worker after the window elapses.
// Cancellation = users.drafts.delete. No `gmail.send` direct path — we
// always go through drafts so the user could intervene in Gmail if Steadii
// crashes.
// ---------------------------------------------------------------------------

export class GmailDraftCreationError extends Error {
  code = "GMAIL_DRAFT_CREATE_FAILED" as const;
}
export class GmailDraftSendError extends Error {
  code = "GMAIL_DRAFT_SEND_FAILED" as const;
}

export type GmailDraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null; // Gmail message id we're replying to
  threadId?: string | null; // Gmail thread id (keeps reply in-thread)
};

// RFC 2822 message. Keep headers minimal — Gmail fills From / Date from
// the authenticated account. We quote subjects that need quoting (newline
// chars are rejected) and MIME-encode the body as UTF-8 text/plain. For α
// every reply is plain text; rich HTML is post-α.
function buildRfc2822(input: GmailDraftInput): string {
  const lines: string[] = [];
  lines.push(`To: ${input.to.join(", ")}`);
  if (input.cc && input.cc.length > 0) lines.push(`Cc: ${input.cc.join(", ")}`);
  if (input.bcc && input.bcc.length > 0)
    lines.push(`Bcc: ${input.bcc.join(", ")}`);
  lines.push(`Subject: ${encodeSubjectIfNeeded(input.subject)}`);
  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`);
    lines.push(`References: ${input.inReplyTo}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(input.body);
  return lines.join("\r\n");
}

function encodeSubjectIfNeeded(subject: string): string {
  // Plain ASCII subjects pass through. Anything with non-ASCII gets RFC
  // 2047 Base64 encoding so the Subject header stays legal.
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const base64 = Buffer.from(subject, "utf-8").toString("base64");
  return `=?UTF-8?B?${base64}?=`;
}

// Gmail API's `raw` field must be URL-safe base64 of the RFC-2822 payload.
export function encodeGmailRaw(input: GmailDraftInput): string {
  const raw = buildRfc2822(input);
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Step 1 — create a Gmail draft. Returns the Gmail draft id + the
// message id inside it. The message id is useful for later reference
// (e.g. "this is the reply that eventually became message X").
export async function createGmailDraft(
  userId: string,
  input: GmailDraftInput
): Promise<{ gmailDraftId: string; gmailMessageId: string | null }> {
  return Sentry.startSpan(
    {
      name: "gmail.drafts.create",
      op: "http.client",
      attributes: { "steadii.user_id": userId },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const raw = encodeGmailRaw(input);
        const res = await gmail.users.drafts.create({
          userId: "me",
          requestBody: {
            message: {
              raw,
              threadId: input.threadId ?? undefined,
            },
          },
        });
        const draftId = res.data.id;
        const messageId = res.data.message?.id ?? null;
        if (!draftId) throw new GmailDraftCreationError("Missing draft id");
        return { gmailDraftId: draftId, gmailMessageId: messageId };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "drafts.create" },
          user: { id: userId },
        });
        if (err instanceof GmailDraftCreationError) throw err;
        const wrapped = new GmailDraftCreationError(
          err instanceof Error ? err.message : String(err)
        );
        throw wrapped;
      }
    }
  );
}

// Step 2 — promote the draft. Gmail returns the sent message id (different
// from the draft-message id; some clients reuse but we don't assume).
export async function sendGmailDraft(
  userId: string,
  gmailDraftId: string
): Promise<{ gmailMessageId: string }> {
  return Sentry.startSpan(
    {
      name: "gmail.drafts.send",
      op: "http.client",
      attributes: {
        "steadii.user_id": userId,
        "gmail.draft_id": gmailDraftId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const res = await gmail.users.drafts.send({
          userId: "me",
          requestBody: { id: gmailDraftId },
        });
        const messageId = res.data.id;
        if (!messageId) throw new GmailDraftSendError("Missing message id");
        return { gmailMessageId: messageId };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "drafts.send" },
          user: { id: userId },
        });
        if (err instanceof GmailDraftSendError) throw err;
        throw new GmailDraftSendError(
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );
}

// Cancel = delete the Gmail draft. Safe if the draft was already deleted
// by the user in Gmail's UI — we swallow 404.
export async function deleteGmailDraft(
  userId: string,
  gmailDraftId: string
): Promise<void> {
  return Sentry.startSpan(
    {
      name: "gmail.drafts.delete",
      op: "http.client",
      attributes: {
        "steadii.user_id": userId,
        "gmail.draft_id": gmailDraftId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        await gmail.users.drafts.delete({
          userId: "me",
          id: gmailDraftId,
        });
      } catch (err) {
        const status = (
          err as { response?: { status?: number }; code?: number }
        )?.response?.status ?? (err as { code?: number })?.code;
        if (status === 404) return;
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "drafts.delete" },
          user: { id: userId },
        });
        throw err;
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Tool schema. Used when a future agent chat surface wants to invoke Gmail
// from a chat message; W3 uses the helpers above directly for draft-review
// UI. Registering the schema now means the chat tool-registry can pick it
// up without further changes.
// ---------------------------------------------------------------------------

const gmailSendArgs = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  inReplyTo: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
});

export const gmailSendTool: ToolExecutor<
  z.infer<typeof gmailSendArgs>,
  { gmailDraftId: string; gmailMessageId: string | null }
> = {
  schema: {
    name: "gmail_send",
    description:
      "Create a Gmail draft from the user's authenticated Gmail. Destructive — the caller must honor the confirm + 20-second undo flow before promoting the draft to sent.",
    mutability: "destructive",
    parameters: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, minItems: 1 },
        cc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        inReplyTo: { type: ["string", "null"] },
        threadId: { type: ["string", "null"] },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = gmailSendArgs.parse(rawArgs);
    const res = await createGmailDraft(ctx.userId, {
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.body,
      inReplyTo: args.inReplyTo ?? null,
      threadId: args.threadId ?? null,
    });
    await db.insert(auditLog).values({
      userId: ctx.userId,
      action: "gmail.draft_create",
      toolName: "gmail_send",
      resourceType: "gmail_draft",
      resourceId: res.gmailDraftId,
      result: "success",
      detail: {
        to: args.to,
        cc: args.cc ?? [],
        subjectLength: args.subject.length,
        bodyLength: args.body.length,
      },
    });
    return res;
  },
};

// Convenience — used by the send_queue worker after the undo window
// elapses. Not exposed as a tool because it's an internal dispatcher
// step; the audit log still records the final send.
export async function sendAndAudit(
  userId: string,
  gmailDraftId: string,
  agentDraftId: string
): Promise<{ gmailMessageId: string }> {
  const res = await sendGmailDraft(userId, gmailDraftId);
  await db.insert(auditLog).values({
    userId,
    action: "gmail.send",
    toolName: "gmail_send",
    resourceType: "agent_draft",
    resourceId: agentDraftId,
    result: "success",
    detail: {
      gmailDraftId,
      gmailMessageId: res.gmailMessageId,
    },
  });
  return res;
}
