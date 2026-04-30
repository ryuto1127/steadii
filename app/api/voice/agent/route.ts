import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  content: z.string().min(1).max(16_000),
});

// Phase 3 global voice + overlay endpoint. Runs the user's message through
// the full agent (same orchestrator as /api/chat) and inspects the result
// to decide whether the response is best surfaced as a one-shot operation
// toast or as a chat to open in the overlay.
//
// Shape:
//   { kind: "operation", summary, executed: [{ tool, ok }, ...] }
//     – Returned when the orchestrator executed >= 1 tool with no pending
//       confirmations. The chat created to feed the orchestrator is
//       soft-deleted so it does NOT appear in chat history (matches Ryuto's
//       "operation mode does not save to chat history" instruction).
//
//   { kind: "chat", chatId, userMessage, assistantMessage, needsConfirmation? }
//     – Returned when the orchestrator only emitted text (no tools), or
//       when a high-risk tool requires confirmation. Chat is persisted so
//       the inline confirmation card / message history work as usual; the
//       client opens the overlay (or hops to /app/chat/[id] for the
//       confirmation flow).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { content: string };
  try {
    const raw = await request.json();
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Same gate as /api/chat — we're effectively running a chat turn, so the
  // per-plan hourly/daily caps apply. Voice cleanup ran on /api/voice with
  // its own bucket; this is the agent half.
  try {
    enforceRateLimit(userId, "chat.message", BUCKETS.chatMessage);
    const eff = await getEffectivePlan(userId);
    enforceChatLimits(userId, eff.plan);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  // Create a chat row to give the orchestrator something to write into.
  // We may soft-delete it after the run if the result is operation-mode.
  const [created] = await db
    .insert(chats)
    .values({ userId })
    .returning({ id: chats.id });
  const chatId = created.id;

  await db.insert(messagesTable).values({
    chatId,
    role: "user",
    content: body.content,
  });

  // Drive the orchestrator to completion, collecting the events we care
  // about (tool calls executed + final assistant text + confirmations).
  const argsByCallId = new Map<string, unknown>();
  const executed: Array<{ tool: string; ok: boolean; args: unknown; result: unknown }> = [];
  let assistantText = "";
  let needsConfirmation = false;

  try {
    for await (const ev of streamChatResponse({ userId, chatId })) {
      if (ev.type === "tool_call_started") {
        argsByCallId.set(ev.toolCallId, ev.args);
      } else if (ev.type === "tool_call_result") {
        executed.push({
          tool: ev.toolName,
          ok: ev.ok,
          args: argsByCallId.get(ev.toolCallId),
          result: ev.result,
        });
      } else if (ev.type === "tool_call_pending") {
        needsConfirmation = true;
      } else if (ev.type === "message_end") {
        assistantText = ev.text;
      }
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "agent failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 }
    );
  }

  // Operation mode: tools ran cleanly with no pending confirmations.
  if (executed.length > 0 && !needsConfirmation) {
    // Soft-delete the chat — operation-mode is one-shot per spec.
    await db
      .update(chats)
      .set({ deletedAt: new Date() })
      .where(eq(chats.id, chatId));

    const summary = makeOperationSummary({
      executed,
      assistantText,
      userMessage: body.content,
    });

    return NextResponse.json({
      kind: "operation" as const,
      summary,
      executed: executed.map((e) => ({ tool: e.tool, ok: e.ok })),
    });
  }

  // Chat mode (text-only OR confirmation needed).
  // Title the chat so it shows up properly in history. Best-effort.
  if (assistantText) {
    try {
      await generateChatTitle(userId, chatId, body.content, assistantText);
    } catch (err) {
      console.warn("voice/agent title gen failed", err);
    }
  }

  return NextResponse.json({
    kind: "chat" as const,
    chatId,
    userMessage: body.content,
    assistantMessage: assistantText,
    needsConfirmation,
  });
}

// Pick the best human-readable summary for an operation. Priority:
//   1. The agent's own short text reply (already phrased for the user)
//   2. Generic "<tool> ran" / "N actions completed" fallback
//
// Cap at 200 chars so the toast doesn't overwhelm the screen.
function makeOperationSummary(args: {
  executed: Array<{ tool: string; ok: boolean }>;
  assistantText: string;
  userMessage: string;
}): string {
  const trimmed = args.assistantText.trim();
  if (trimmed.length > 0 && trimmed.length <= 200) return trimmed;
  if (trimmed.length > 200) return trimmed.slice(0, 197) + "…";
  if (args.executed.length === 1) {
    return prettyToolLabel(args.executed[0].tool) + " — done";
  }
  return `${args.executed.length} actions completed`;
}

function prettyToolLabel(toolName: string): string {
  // tool names in the registry are lower_snake_case (e.g. "tasks_add").
  // Map well-known prefixes; fall back to a humanised form so unknown tools
  // still produce readable toasts.
  const known: Record<string, string> = {
    tasks_add: "Task added",
    tasks_complete: "Task completed",
    tasks_reschedule: "Task rescheduled",
    classes_add: "Class added",
    calendar_create_event: "Event added",
    calendar_update_event: "Event updated",
  };
  if (known[toolName]) return known[toolName];
  return toolName.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
