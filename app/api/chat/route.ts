import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  streamChatResponse,
  generateChatTitle,
} from "@/lib/agent/orchestrator";
import {
  BUCKETS,
  RateLimitError,
  enforceChatLimits,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { getEffectivePlan } from "@/lib/billing/effective-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Accepts an optional first-message payload. When `content` is present we
// create the chat AND persist the first user message in a single request,
// so the client can navigate to /app/chat/[id] after one round-trip instead
// of three (create → message → navigate).
const createBodySchema = z
  .object({ content: z.string().max(16_000).optional() })
  .optional();

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  let content: string | undefined;
  const ctype = request.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    try {
      const raw = await request.json();
      const parsed = createBodySchema.safeParse(raw);
      if (parsed.success) content = parsed.data?.content?.trim() || undefined;
    } catch {
      // Empty body / non-JSON — legacy callers just POST with no body.
    }
  }

  // If the caller is creating a chat with a first message, apply the same
  // rate-limit gate that /api/chat/message does. Empty creates (legacy
  // client) skip the gate to stay backwards-compatible.
  if (content) {
    try {
      enforceRateLimit(userId, "chat.message", BUCKETS.chatMessage);
      const eff = await getEffectivePlan(userId);
      enforceChatLimits(userId, eff.plan);
    } catch (err) {
      if (err instanceof RateLimitError) return rateLimitResponse(err);
      throw err;
    }
  }

  const [row] = await db
    .insert(chats)
    .values({ userId })
    .returning({ id: chats.id });
  const chatId = row.id;

  if (content) {
    await db.insert(messagesTable).values({
      chatId,
      role: "user",
      content,
    });
  }

  return NextResponse.json({ id: chatId });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // Two-layer gate: burst protection + per-plan hourly/daily caps. See
    // /api/chat/message for the parallel logic; chat uses the same ceiling.
    enforceRateLimit(userId, "chat.stream", BUCKETS.chatStream);
    const eff = await getEffectivePlan(userId);
    enforceChatLimits(userId, eff.plan);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  const chatId = request.nextUrl.searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) {
    return NextResponse.json({ error: "chat not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        let fullText = "";
        let assistantId: string | null = null;

        for await (const ev of streamChatResponse({ userId, chatId })) {
          if (ev.type === "message_start") assistantId = ev.assistantMessageId;
          if (ev.type === "text_delta") fullText += ev.delta;
          send(ev);
        }

        if (!chat.title && assistantId && fullText) {
          const firstUser = await firstUserMessage(chatId);
          if (firstUser) {
            try {
              const title = await generateChatTitle(userId, chatId, firstUser, fullText);
              send({ type: "title", title });
            } catch (err) {
              console.error("Title generation failed", err);
            }
          }
        }

        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          code: "STREAM_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function firstUserMessage(chatId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(asc(messagesTable.createdAt))
    .limit(1);
  return rows[0]?.content ?? null;
}
