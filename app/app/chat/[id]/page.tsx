import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { chats, messages, messageAttachments } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  deleteChatAction,
  renameChatAction,
} from "@/lib/agent/chat-actions";
import { ChatView } from "@/components/chat/chat-view";

export default async function SingleChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;

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

  const attachments = await db
    .select()
    .from(messageAttachments);

  const byMessage = new Map<string, typeof attachments>();
  for (const a of attachments) {
    if (!byMessage.has(a.messageId)) byMessage.set(a.messageId, []);
    byMessage.get(a.messageId)!.push(a);
  }

  const visible = msgs
    .filter((m) => !m.deletedAt)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      attachments: (byMessage.get(m.id) ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.url,
        filename: a.filename,
      })),
    }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-4">
        <form action={renameChatAction} className="flex-1">
          <input type="hidden" name="id" value={chat.id} />
          <input
            name="title"
            defaultValue={chat.title ?? ""}
            placeholder="Untitled chat"
            className="w-full bg-transparent font-serif text-2xl focus:outline-none"
          />
        </form>
        <form action={deleteChatAction}>
          <input type="hidden" name="id" value={chat.id} />
          <button
            type="submit"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
          >
            Delete
          </button>
        </form>
      </header>

      <ChatView
        chatId={chat.id}
        initialMessages={visible}
        blobConfigured={!!process.env.BLOB_READ_WRITE_TOKEN}
      />
    </div>
  );
}
