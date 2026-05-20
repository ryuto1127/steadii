// 2026-05-19 — Phase 3 of the proactive-task UX. Handles the smart-action
// button click on a task card: creates a chat, seeds it with a user
// message derived from the task's intent + preview metadata, redirects
// to /app/chat/<id>?stream=1 so the agent run starts immediately.
//
// Distinct from /api/chat/seeded — that one supports a fixed set of
// i18n-keyed prompts (review_recent_mistakes, etc.). This one consults
// task_intent_metadata to build the seed dynamically per task.

import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  chats,
  messages as messagesTable,
  taskIntentMetadata,
  type TaskIntentSourceValue,
} from "@/lib/db/schema";
import { buildSeededMessage } from "@/lib/agent/from-task-seed";

export const runtime = "nodejs";

const ALLOWED_SOURCES: ReadonlyArray<TaskIntentSourceValue> = [
  "google_tasks",
  "microsoft_todo",
  "steadii",
];

function isSource(value: unknown): value is TaskIntentSourceValue {
  return (
    typeof value === "string" &&
    (ALLOWED_SOURCES as readonly string[]).includes(value)
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const form = await request.formData();
  const source = form.get("source");
  const externalId = form.get("externalId");
  if (!isSource(source) || typeof externalId !== "string" || externalId.length === 0) {
    return NextResponse.json({ error: "invalid task ref" }, { status: 400 });
  }

  // Resolve the intent metadata. RLS isn't on this table, so we filter
  // by userId explicitly to prevent cross-user task references via a
  // forged form post.
  const [row] = await db
    .select()
    .from(taskIntentMetadata)
    .where(
      and(
        eq(taskIntentMetadata.userId, userId),
        eq(taskIntentMetadata.source, source),
        eq(taskIntentMetadata.externalId, externalId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: "task intent metadata not found" },
      { status: 404 },
    );
  }

  const seededMessage = buildSeededMessage({
    intent: row.intent,
    title: row.title,
    preview: row.preview,
  });

  const [chat] = await db
    .insert(chats)
    .values({ userId })
    .returning({ id: chats.id });

  await db.insert(messagesTable).values({
    chatId: chat.id,
    role: "user",
    content: seededMessage,
  });

  redirect(`/app/chat/${chat.id}?stream=1`);
}

// buildSeededMessage lives in lib/agent/from-task-seed.ts (no auth /
// next-server deps) so unit tests can import it directly.
export { buildSeededMessage } from "@/lib/agent/from-task-seed";
