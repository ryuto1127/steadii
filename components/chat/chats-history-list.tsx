"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { DenseList } from "@/components/ui/dense-list";
import { ChatHistoryRow } from "@/components/chat/chat-history-row";
import {
  CHAT_RECENCY_BUCKET_ORDER,
  groupByBucket,
  type ChatRecencyBucket,
} from "@/lib/utils/chat-recency-buckets";

export type ChatsHistoryRow = {
  id: string;
  title: string;
  updatedAtIso: string;
  updatedAtLabel: string;
};

// Client island wrapper for the /app/chats history list. The page
// fetches rows server-side and passes an already-formatted set
// (timestamp ISO + locale-formatted label) so this layer stays pure
// presentation: search + recency grouping. Keeps the route as a
// server component for auth + redirect handling and confines the
// client bundle to the interactive bits.
export function ChatsHistoryList({ rows }: { rows: ChatsHistoryRow[] }) {
  const t = useTranslations("chats_list");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.title.toLowerCase().includes(q));
  }, [rows, query]);

  const grouped = useMemo(
    () =>
      groupByBucket<ChatsHistoryRow>(
        filtered,
        (r) => new Date(r.updatedAtIso)
      ),
    [filtered]
  );

  const bucketLabel: Record<ChatRecencyBucket, string> = {
    today: t("group_today"),
    yesterday: t("group_yesterday"),
    week: t("group_week"),
    earlier: t("group_earlier"),
  };

  const hasResults = filtered.length > 0;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]">
        <Search
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="text-[hsl(var(--muted-foreground))]"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search_placeholder")}
          aria-label={t("search_aria")}
          className="w-full bg-transparent text-body text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
        />
      </label>

      {hasResults ? (
        <div className="space-y-6">
          {CHAT_RECENCY_BUCKET_ORDER.map((bucket) => {
            const items = grouped[bucket];
            if (items.length === 0) return null;
            return (
              <section key={bucket} aria-labelledby={`chats-bucket-${bucket}`}>
                <h2
                  id={`chats-bucket-${bucket}`}
                  className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]"
                >
                  {bucketLabel[bucket]}
                </h2>
                <DenseList ariaLabel={bucketLabel[bucket]}>
                  {items.map((chat) => (
                    <ChatHistoryRow
                      key={chat.id}
                      id={chat.id}
                      title={chat.title}
                      updatedAt={chat.updatedAtLabel}
                    />
                  ))}
                </DenseList>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-small text-[hsl(var(--muted-foreground))]">
          {t("no_search_results")}
        </p>
      )}
    </div>
  );
}
