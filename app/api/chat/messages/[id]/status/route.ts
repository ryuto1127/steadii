import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-58 — polled by the chat UI every 2s while an assistant row is
// in status='processing' (because the SSE stream was either never started
// or got cut by a tab close). Returns enough to render the in-progress
// chip + final result without a full chat refetch: the assistant row's
// content / toolCalls / status + any tool-response rows that landed
// against those tool_call_ids while polling.
//
// Also includes a stale-row safety net: any row marked 'processing' for
// longer than the lambda's maxDuration window is auto-flipped to 'error'
// on read. This catches lambda crashes that prevented the orchestrator
// from flipping the terminal status itself.
const STALE_PROCESSING_THRESHOLD_MS = 6 * 60 * 1000;

type ToolResultRow = {
  toolCallId: string | null;
  content: string;
  createdAt: Date;
};

type StatusResponse = {
  id: string;
  chatId: string;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  content: string;
  toolCalls: unknown;
  toolResults: Array<{ toolCallId: string; content: string }>;
  updatedAt: string;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  // Join the message row to chats so we can verify the requester owns the
  // chat. Without this, any authenticated user could probe arbitrary
  // message UUIDs and learn their status. The join also avoids a separate
  // SELECT roundtrip.
  const [row] = await db
    .select({
      id: messagesTable.id,
      chatId: messagesTable.chatId,
      role: messagesTable.role,
      content: messagesTable.content,
      toolCalls: messagesTable.toolCalls,
      status: messagesTable.status,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(chats, eq(messagesTable.chatId, chats.id))
    .where(and(eq(messagesTable.id, id), eq(chats.userId, userId)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  let effectiveStatus = row.status;

  // Stale-row safety net. If the orchestrator's lambda crashed mid-run,
  // the row stays 'processing' forever and the UI's poll loop never
  // terminates. Past the maxDuration ceiling (with a 1-minute buffer) we
  // know the orchestrator can't possibly still be working — mark
  // 'error' so the UI moves on.
  if (
    row.status === "processing" &&
    Date.now() - row.createdAt.getTime() > STALE_PROCESSING_THRESHOLD_MS
  ) {
    try {
      await db
        .update(messagesTable)
        .set({ status: "error" })
        .where(eq(messagesTable.id, row.id));
      effectiveStatus = "error";
    } catch {
      // Best-effort. If the DB update fails the next poll will retry.
    }
  }

  // Pull tool-response rows for THIS chat that landed against any of this
  // assistant message's tool_call_ids. The orchestrator writes one tool
  // row per executed call so a resumed UI can rebuild the same chip
  // states the live stream would have shown.
  const toolCallIds = extractToolCallIds(row.toolCalls);
  let toolResults: Array<{ toolCallId: string; content: string }> = [];
  if (toolCallIds.length > 0) {
    const rows = (await db
      .select({
        toolCallId: messagesTable.toolCallId,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.chatId, row.chatId),
          eq(messagesTable.role, "tool")
        )
      )
      .orderBy(asc(messagesTable.createdAt))) as ToolResultRow[];
    toolResults = rows
      .filter((r): r is { toolCallId: string; content: string; createdAt: Date } =>
        r.toolCallId !== null && toolCallIds.includes(r.toolCallId)
      )
      .map((r) => ({ toolCallId: r.toolCallId, content: r.content }));
  }

  const body: StatusResponse = {
    id: row.id,
    chatId: row.chatId,
    status: effectiveStatus,
    content: row.content,
    toolCalls: row.toolCalls,
    toolResults,
    updatedAt: row.createdAt.toISOString(),
  };

  return NextResponse.json(body);
}

function extractToolCallIds(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const ids: string[] = [];
  for (const c of toolCalls) {
    if (c && typeof c === "object" && "id" in c) {
      const id = (c as { id: unknown }).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}
