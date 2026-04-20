import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db/client";
import { chats, messages, messageAttachments } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  deleteChatAction,
  renameChatAction,
} from "@/lib/agent/chat-actions";
import { ChatView } from "@/components/chat/chat-view";
import { Plus } from "lucide-react";

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
      <header className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
        <form action={renameChatAction} className="flex-1">
          <input type="hidden" name="id" value={chat.id} />
          <input
            name="title"
            defaultValue={chat.title ?? ""}
            placeholder="Untitled chat"
            className="w-full bg-transparent text-h2 text-[hsl(var(--foreground))] focus:outline-none"
          />
        </form>
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            <Plus size={13} strokeWidth={1.5} />
            New chat
          </Link>
          <form action={deleteChatAction}>
            <input type="hidden" name="id" value={chat.id} />
            <button
              type="submit"
              className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
            >
              Delete
            </button>
          </form>
        </div>
      </header>

      <ChatView
        chatId={chat.id}
        initialMessages={visible}
        blobConfigured={!!process.env.BLOB_READ_WRITE_TOKEN}
        autoStream={stream === "1"}
      />
    </div>
  );
}
