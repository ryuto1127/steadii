import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  BUCKETS,
  RateLimitError,
  enforceChatLimits,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { getEffectivePlan } from "@/lib/billing/effective-plan";

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

  try {
    // Two-layer gate:
    //   1. Burst protection (anti-abuse within a minute) — same for all users
    //   2. Per-plan hourly + daily caps — replaces credit metering for chat
    enforceRateLimit(userId, "chat.message", BUCKETS.chatMessage);
    const eff = await getEffectivePlan(userId);
    enforceChatLimits(userId, eff.plan);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

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
