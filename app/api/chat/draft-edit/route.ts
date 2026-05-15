import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  auditLog,
  chats,
  messages as messagesTable,
} from "@/lib/db/schema";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { detectDraftBlocks } from "@/lib/chat/draft-detect";

export const runtime = "nodejs";

// engineer-63 — inline edit of a draft-shaped code block in an assistant
// message. Updates messages.content by re-detecting the block (against the
// CURRENT content, not a client-supplied offset) and splicing in the new
// body. Surrounding prose + meta-commentary + code fences are preserved.
// The client renders the new body locally too so the user sees the change
// without a router.refresh.

const bodySchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
  blockIndex: z.number().int().min(0),
  newBody: z.string().min(1).max(50_000),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    enforceRateLimit(userId, "chat.draft_edit", BUCKETS.chatMessage);
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

  const [row] = await db
    .select({
      id: messagesTable.id,
      role: messagesTable.role,
      content: messagesTable.content,
    })
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
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }
  if (row.role !== "assistant") {
    return NextResponse.json(
      { error: "edits only apply to assistant messages" },
      { status: 400 }
    );
  }

  const drafts = detectDraftBlocks(row.content);
  const target = drafts[parsed.blockIndex];
  if (!target) {
    return NextResponse.json(
      { error: "draft block not found at the supplied index" },
      { status: 404 }
    );
  }

  const updatedContent =
    row.content.slice(0, target.bodyStart) +
    parsed.newBody +
    row.content.slice(target.bodyEnd);

  await db
    .update(messagesTable)
    .set({ content: updatedContent })
    .where(eq(messagesTable.id, parsed.messageId));

  await db.insert(auditLog).values({
    userId,
    action: "chat.draft_edited_by_user",
    resourceType: "chat_message",
    resourceId: parsed.messageId,
    result: "success",
    detail: {
      chatId: parsed.chatId,
      blockIndex: parsed.blockIndex,
      oldBodyLength: target.body.length,
      newBodyLength: parsed.newBody.length,
    },
  });

  return NextResponse.json({ ok: true });
}
