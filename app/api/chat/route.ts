import { NextResponse, after, type NextRequest } from "next/server";
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

// engineer-58 — agent runs can take up to 5 minutes (MAX_TOOL_ITERATIONS=18
// × tool latency + LLM completions). Combined with after() below, this lets
// the orchestrator finish its loop and persist results even when the SSE
// response stream has already been cut by a tab close on the client side.
// Without this, Vercel terminates the lambda the moment the response ends,
// leaving the assistant message stuck in status='processing' forever.
export const maxDuration = 300;

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

// engineer-58 — events the orchestrator can emit, augmented with the two
// outer events the route handler adds (title + done). Buffered into an
// in-memory queue so the orchestrator can keep pushing even after the SSE
// consumer has stopped reading (e.g. tab closed).
type StreamEvent =
  | { type: "message_start"; assistantMessageId: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_started"; toolName: string; args: unknown; toolCallId: string }
  | { type: "tool_call_result"; toolName: string; toolCallId: string; result: unknown; ok: boolean }
  | { type: "tool_call_pending"; toolName: string; toolCallId: string; pendingId: string; args: unknown }
  | { type: "message_end"; assistantMessageId: string; text: string }
  | { type: "error"; code: string; message: string }
  | { type: "title"; title: string }
  | { type: "done" };

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

  // engineer-58 — decouple the orchestrator loop from the SSE response so a
  // tab close doesn't kill the agent mid-run.
  //
  // The orchestrator pushes into an in-memory queue; the SSE controller
  // drains the queue. If the client disconnects the controller errors out
  // on enqueue but the orchestrator keeps pushing — Vercel keeps the
  // lambda alive because `after()` is registered with the orchestrator's
  // completion promise. The orchestrator already persists every event to
  // the DB, so the work survives the disconnect; status='processing' on
  // the assistant row lets the UI resume via polling when the user comes
  // back. See lib/agent/orchestrator.ts → insertPendingAssistant.
  const queue: StreamEvent[] = [];
  let queueDone = false;
  let pendingWaiter: (() => void) | null = null;

  const pump = (): void => {
    const w = pendingWaiter;
    pendingWaiter = null;
    if (w) w();
  };

  const enqueue = (ev: StreamEvent) => {
    queue.push(ev);
    pump();
  };

  let assistantId: string | null = null;
  const orchestratorPromise = (async () => {
    try {
      let fullText = "";
      for await (const ev of streamChatResponse({ userId, chatId })) {
        if (ev.type === "message_start") assistantId = ev.assistantMessageId;
        if (ev.type === "text_delta") fullText += ev.delta;
        enqueue(ev as StreamEvent);
      }

      // Generate a title even when the assistant turn was tool-calls only
      // (no text deltas) — fall back to the user message as the seed so
      // chats like "5/16 学校休む" still get titled rather than staying
      // "(no title)".
      if (!chat.title && assistantId) {
        const firstUser = await firstUserMessage(chatId);
        if (firstUser) {
          try {
            const titleSeed = fullText || firstUser;
            const title = await generateChatTitle(
              userId,
              chatId,
              firstUser,
              titleSeed
            );
            enqueue({ type: "title", title });
          } catch (err) {
            console.error("Title generation failed", err);
          }
        }
      }
      enqueue({ type: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      enqueue({ type: "error", code: "STREAM_FAILED", message });
      // The orchestrator's own catch-paths (OPENAI_FAILED etc.) flip
      // status='error' on the assistant row. If we land here via an
      // unexpected throw that bypassed those paths, mark the row so the
      // polling UI doesn't keep waiting on a corpse.
      if (assistantId) {
        try {
          await db
            .update(messagesTable)
            .set({ status: "error" })
            .where(eq(messagesTable.id, assistantId));
        } catch {
          // Best-effort.
        }
      }
    } finally {
      queueDone = true;
      pump();
    }
  })();

  // Tells Vercel: keep this lambda alive until the orchestrator promise
  // resolves, even after the SSE response stream has closed. `maxDuration`
  // above bounds how long that "alive" window is.
  after(orchestratorPromise);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientClosed = false;
      const send = (ev: StreamEvent) => {
        if (clientClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)
          );
        } catch {
          // Controller closed (client disconnected). Stop trying to
          // enqueue; orchestrator keeps running via after().
          clientClosed = true;
        }
      };

      let consumed = 0;
      while (true) {
        if (consumed < queue.length) {
          send(queue[consumed++]);
          if (clientClosed) return;
          continue;
        }
        if (queueDone) break;
        await new Promise<void>((resolve) => {
          pendingWaiter = resolve;
          // Re-check after registering: queue may have grown between the
          // length check above and waiter assignment. Resolve immediately
          // if so to avoid stalling on a notification that already fired.
          if (consumed < queue.length || queueDone) {
            pendingWaiter = null;
            resolve();
          }
        });
      }

      try {
        controller.close();
      } catch {
        // Controller already closed by the client disconnect path.
      }
    },
    cancel() {
      // Client disconnected from the SSE stream. The orchestrator promise
      // keeps running courtesy of after() — nothing to do here.
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
