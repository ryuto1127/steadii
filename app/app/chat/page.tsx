import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createChatAction } from "@/lib/agent/chat-actions";

export default async function ChatListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const rows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
    .orderBy(desc(chats.updatedAt));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Chats</h1>
        <form action={createChatAction}>
          <button
            type="submit"
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
          >
            New chat
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Nothing yet. Start a new chat.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
          {rows.map((chat) => (
            <li key={chat.id}>
              <Link
                href={`/app/chat/${chat.id}`}
                className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
              >
                <span className="font-medium">{chat.title ?? "Untitled chat"}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {chat.updatedAt.toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
