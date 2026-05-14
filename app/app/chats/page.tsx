import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { ContextualSuggestion } from "@/components/suggestions/contextual-suggestion";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ChatsHistoryList,
  type ChatsHistoryRow,
} from "@/components/chat/chats-history-list";

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

  const locale = await getLocale();
  const dateLocale = locale === "ja" ? "ja-JP" : "en-US";
  const t = await getTranslations("chats_list");
  const tChat = await getTranslations("chat_view");

  const presentationRows: ChatsHistoryRow[] = rows.map((chat) => ({
    id: chat.id,
    title: chat.title ?? tChat("title_placeholder"),
    updatedAtIso: chat.updatedAt.toISOString(),
    updatedAtLabel: chat.updatedAt.toLocaleDateString(dateLocale),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>
        <Link
          href="/app"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <Plus size={14} strokeWidth={1.5} />
          {t("new_chat")}
        </Link>
      </header>

      <ContextualSuggestion
        userId={userId}
        source="ical"
        surface="trigger_chat_ical"
        revalidatePath="/app/chats"
      />

      {presentationRows.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare size={18} strokeWidth={1.5} />}
          title={t("empty_title")}
          description={t("empty_description")}
          actions={[{ label: t("empty_action"), href: "/app" }]}
        />
      ) : (
        <ChatsHistoryList rows={presentationRows} />
      )}
    </div>
  );
}
