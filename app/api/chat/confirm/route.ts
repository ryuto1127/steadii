import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  pendingToolCalls,
  messages as messagesTable,
  auditLog,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getToolByName } from "@/lib/agent/tool-registry";
import { z } from "zod";

const bodySchema = z.object({
  pendingId: z.string().uuid(),
  decision: z.enum(["approve", "deny"]),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [pending] = await db
    .select()
    .from(pendingToolCalls)
    .where(
      and(
        eq(pendingToolCalls.id, parsed.data.pendingId),
        eq(pendingToolCalls.userId, userId)
      )
    )
    .limit(1);

  if (!pending) {
    return NextResponse.json({ error: "pending not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: "already resolved" }, { status: 409 });
  }

  if (parsed.data.decision === "deny") {
    await db.insert(messagesTable).values({
      chatId: pending.chatId,
      role: "tool",
      content: JSON.stringify({
        error: "user_denied_confirmation",
        message: "User declined this operation.",
      }),
      toolCallId: pending.toolCallId,
    });
    await db
      .update(pendingToolCalls)
      .set({ status: "denied", resolvedAt: new Date() })
      .where(eq(pendingToolCalls.id, pending.id));
    await db.insert(auditLog).values({
      userId,
      action: `${pending.toolName}.denied`,
      toolName: pending.toolName,
      result: "failure",
      detail: { reason: "user_denied" },
    });
    return NextResponse.json({ status: "denied" });
  }

  const tool = getToolByName(pending.toolName);
  if (!tool) {
    await db
      .update(pendingToolCalls)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(eq(pendingToolCalls.id, pending.id));
    return NextResponse.json({ error: "unknown tool" }, { status: 400 });
  }

  let result: unknown;
  let ok = true;
  try {
    result = await tool.execute({ userId }, pending.args);
  } catch (err) {
    ok = false;
    result = { error: err instanceof Error ? err.message : "tool_failed" };
  }

  await db.insert(messagesTable).values({
    chatId: pending.chatId,
    role: "tool",
    content: JSON.stringify(result),
    toolCallId: pending.toolCallId,
  });

  await db
    .update(pendingToolCalls)
    .set({ status: "approved", resolvedAt: new Date() })
    .where(eq(pendingToolCalls.id, pending.id));

  return NextResponse.json({ status: ok ? "approved" : "approved_failed", result });
}
