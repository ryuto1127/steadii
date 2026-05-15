import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  auditLog,
  chats,
  inboxItems,
  messages as messagesTable,
} from "@/lib/db/schema";
import {
  createGmailDraft,
  sendGmailDraft,
} from "@/lib/agent/tools/gmail";
import { getMessage } from "@/lib/integrations/google/gmail-fetch";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { buildReplySubject } from "@/lib/chat/draft-detect";

export const runtime = "nodejs";

// engineer-63 — user-initiated send from a chat draft action bar. Reuses
// the same Gmail draft+send primitives the agent uses, so rate limits,
// audit, and Gmail-quota accounting all land in the same buckets. Distinct
// from the agent's send_queue path (which has a 10s undo window via QStash)
// — the chat surface uses an in-app confirmation modal as the gate instead.

const bodySchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
  replyToInboxItemId: z.string().uuid(),
  body: z.string().min(1).max(50_000),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  // Reuse chatMessage bucket — same conceptual category (user-initiated
  // action originating from a chat surface), keeps the existing per-plan
  // ceilings in scope without a new bucket.
  try {
    enforceRateLimit(userId, "chat.draft_send", BUCKETS.chatMessage);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid body" },
      { status: 400 }
    );
  }

  // Validate the assistant message belongs to the user (via chat ownership).
  const [msgRow] = await db
    .select({ id: messagesTable.id, chatId: chats.id })
    .from(messagesTable)
    .innerJoin(chats, eq(messagesTable.chatId, chats.id))
    .where(
      and(
        eq(messagesTable.id, parsed.messageId),
        eq(chats.id, parsed.chatId),
        eq(chats.userId, userId),
        isNull(messagesTable.deletedAt)
      )
    )
    .limit(1);
  if (!msgRow) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const [inbox] = await db
    .select({
      id: inboxItems.id,
      externalId: inboxItems.externalId,
      threadExternalId: inboxItems.threadExternalId,
      senderEmail: inboxItems.senderEmail,
      subject: inboxItems.subject,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, parsed.replyToInboxItemId),
        eq(inboxItems.userId, userId),
        isNull(inboxItems.deletedAt)
      )
    )
    .limit(1);
  if (!inbox) {
    return NextResponse.json(
      { error: "reply target not found" },
      { status: 404 }
    );
  }

  // Pull the original RFC Message-ID header so the reply threads correctly
  // in Gmail. Best-effort: if the header fetch fails (Gmail token expired
  // mid-session, message deleted upstream, etc.) we still send via
  // threadId-only, which keeps threading in Gmail web even though strict
  // RFC clients may not associate the reply.
  let inReplyToHeader: string | null = null;
  try {
    const message = await getMessage(userId, inbox.externalId);
    const headers = message.payload?.headers ?? [];
    const found = headers.find(
      (h) => h.name?.toLowerCase() === "message-id"
    );
    inReplyToHeader = found?.value ?? null;
  } catch {
    // Swallow — threadId fallback below.
  }

  const subject = buildReplySubject(inbox.subject);

  let gmailDraftId: string;
  let gmailMessageId: string | null;
  try {
    const draft = await createGmailDraft(userId, {
      to: [inbox.senderEmail],
      subject,
      body: parsed.body,
      inReplyTo: inReplyToHeader,
      threadId: inbox.threadExternalId ?? null,
    });
    gmailDraftId = draft.gmailDraftId;
    const sent = await sendGmailDraft(userId, draft.gmailDraftId);
    gmailMessageId = sent.gmailMessageId;
  } catch (err) {
    await db.insert(auditLog).values({
      userId,
      action: "chat.draft_sent_by_user",
      toolName: "gmail_send",
      resourceType: "chat_message",
      resourceId: parsed.messageId,
      result: "failure",
      detail: {
        chatId: parsed.chatId,
        replyToInboxItemId: parsed.replyToInboxItemId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 502 }
    );
  }

  await db.insert(auditLog).values({
    userId,
    action: "chat.draft_sent_by_user",
    toolName: "gmail_send",
    resourceType: "chat_message",
    resourceId: parsed.messageId,
    result: "success",
    detail: {
      chatId: parsed.chatId,
      replyToInboxItemId: parsed.replyToInboxItemId,
      to: inbox.senderEmail,
      subjectLength: subject.length,
      bodyLength: parsed.body.length,
      gmailDraftId,
      gmailMessageId,
    },
  });

  return NextResponse.json({
    ok: true,
    gmailMessageId,
  });
}
