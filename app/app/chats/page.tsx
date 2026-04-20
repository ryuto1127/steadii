import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ChatsListPage() {
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
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">Chats</h1>
        <Link
          href="/app"
          className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <Plus size={14} strokeWidth={1.5} />
          New chat
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare size={18} strokeWidth={1.5} />}
          title="No chats yet."
          description="Start a conversation from Home."
          actions={[{ label: "Start a conversation", href: "/app" }]}
        />
      ) : (
        <DenseList ariaLabel="Chats">
          {rows.map((chat) => (
            <DenseRowLink
              key={chat.id}
              href={`/app/chat/${chat.id}`}
              title={chat.title ?? "Untitled chat"}
              metadata={[chat.updatedAt.toLocaleDateString()]}
            />
          ))}
        </DenseList>
      )}
    </div>
  );
}
