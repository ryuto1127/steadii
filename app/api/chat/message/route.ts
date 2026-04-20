import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const bodySchema = z.object({
  chatId: z.string().uuid(),
  content: z.string().max(16_000),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, parsed.data.chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) {
    return NextResponse.json({ error: "chat not found" }, { status: 404 });
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      chatId: parsed.data.chatId,
      role: "user",
      content: parsed.data.content.trim(),
    })
    .returning({ id: messagesTable.id });

  await db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, parsed.data.chatId));

  return NextResponse.json({ messageId: msg.id });
}
