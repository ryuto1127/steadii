"use client";

import { useState, useTransition } from "react";
import { Activity, Archive, CheckCircle2, Mail, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { loadActivityPage, type SerializedRow } from "../actions";
import type { ActivityCursor, ActivityKind } from "@/lib/activity/load";

const KIND_ICON: Record<
  ActivityKind,
  React.ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  draft_sent: Mail,
  draft_dismissed: X,
  auto_archived: Archive,
  auto_replied: Mail,
  proposal_resolved: CheckCircle2,
  proposal_dismissed: X,
  calendar_imported: Activity,
  mistake_added: Activity,
  generic: Activity,
};

// Client tail of the activity timeline. Receives the initial cursor;
// pressing the button server-action-loads the next 30 rows and appends
// them as a flat list (no day-grouping in client tail to keep
// re-rendering cheap; the server-side initial render carries grouping).
export function ActivityLoadMore({
  initialCursor,
}: {
  initialCursor: ActivityCursor | null;
}) {
  const t = useTranslations("activity_page");
  const tActions = useTranslations("home_v2.activity_action_label");
  const [cursor, setCursor] = useState<ActivityCursor | null>(initialCursor);
  const [appended, setAppended] = useState<SerializedRow[]>([]);
  const [isPending, startTransition] = useTransition();

  if (!cursor && appended.length === 0) return null;

  const onClick = () => {
    if (!cursor) return;
    startTransition(async () => {
      try {
        const result = await loadActivityPage({ cursor });
        setAppended((prev) => [...prev, ...result.rows]);
        setCursor(result.nextCursor);
      } catch {
        // Soft-fail — leave cursor in place so the button stays clickable
        // for retry. We avoid surfacing a toast for read-only paginations.
      }
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      {appended.length > 0 ? (
        <ul className="flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {appended.map((row) => {
            const occurredAt = new Date(row.occurredAt);
            const Icon = KIND_ICON[row.kind] ?? Activity;
            const verb = tActions(row.kind);
            const inner = (
              <>
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]"
                >
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {verb}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[hsl(var(--foreground))]">
                  {row.primary}
                  {row.secondary ? (
                    <span className="ml-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {row.secondary}
                    </span>
                  ) : null}
                </span>
                <time
                  dateTime={row.occurredAt}
                  title={occurredAt.toLocaleString()}
                  className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]"
                >
                  {occurredAt.toLocaleDateString()}
                </time>
              </>
            );
            return (
              <li
                key={row.id}
                className="flex items-center gap-3 border-b border-[hsl(var(--border)/0.4)] px-3 py-2 last:border-b-0"
              >
                {row.detailHref ? (
                  <Link
                    href={row.detailHref}
                    className="flex w-full items-center gap-3 transition-hover hover:opacity-90"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex w-full items-center gap-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {cursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onClick}
            disabled={isPending}
            className="inline-flex h-9 items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
          >
            {isPending ? t("load_more_loading") : t("load_more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
