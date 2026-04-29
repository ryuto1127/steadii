import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { chats, messages, messageAttachments } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { ChatView } from "@/components/chat/chat-view";

export default async function SingleChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stream?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;
  const { stream } = await searchParams;

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .limit(1);
  if (!chat || chat.deletedAt) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, id))
    .orderBy(asc(messages.createdAt));

  const attachments = await db.select().from(messageAttachments);

  const byMessage = new Map<string, typeof attachments>();
  for (const a of attachments) {
    if (!byMessage.has(a.messageId)) byMessage.set(a.messageId, []);
    byMessage.get(a.messageId)!.push(a);
  }

  // Tool-result messages are stored as their own rows (role: "tool",
  // content: serialized JSON) so the orchestrator can rebuild the
  // OpenAI conversation on resume. Index them by toolCallId so we can
  // re-attach them to the assistant turn that invoked them, instead of
  // rendering raw JSON in the message list.
  const toolResultByCallId = new Map<string, string>();
  for (const m of msgs) {
    if (m.role === "tool" && m.toolCallId && !m.deletedAt) {
      toolResultByCallId.set(m.toolCallId, m.content);
    }
  }

  type StoredToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  };

  const safeJsonParse = (s: string | null | undefined): unknown => {
    if (s == null || s === "") return undefined;
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };

  const visible = msgs
    .filter((m) => !m.deletedAt && m.role !== "tool")
    .map((m) => {
      const storedCalls = Array.isArray(m.toolCalls)
        ? (m.toolCalls as StoredToolCall[])
        : [];
      const items =
        m.role === "assistant" && storedCalls.length > 0
          ? storedCalls.map((c) => {
              const rawResult = toolResultByCallId.get(c.id);
              return {
                kind: "tool" as const,
                event: {
                  id: c.id,
                  toolName: c.function.name,
                  status:
                    rawResult === undefined ? ("running" as const) : ("done" as const),
                  args: safeJsonParse(c.function.arguments),
                  result: rawResult !== undefined ? safeJsonParse(rawResult) : undefined,
                },
              };
            })
          : undefined;
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        items,
        attachments: (byMessage.get(m.id) ?? []).map((a) => ({
          id: a.id,
          kind: a.kind,
          url: a.url,
          filename: a.filename,
        })),
      };
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <ChatView
        chatId={chat.id}
        initialTitle={chat.title}
        initialMessages={visible}
        blobConfigured={!!process.env.BLOB_READ_WRITE_TOKEN}
        autoStream={stream === "1"}
      />
    </div>
  );
}
