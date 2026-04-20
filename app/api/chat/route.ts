import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  streamChatResponse,
  generateChatTitle,
} from "@/lib/agent/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

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
