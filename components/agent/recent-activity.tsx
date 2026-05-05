import "server-only";
import Link from "next/link";
import { Activity, Archive, CheckCircle2, Mail, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { loadActivityRows, type ActivityKind } from "@/lib/activity/load";

// Recent activity footer — the Wave 2 audit log surface. Type-D queue
// cards (FYI / Steadii already did it) collapse into this footer per
// spec. The unified row source lives in `lib/activity/load.ts`; this
// component just renders the latest N rows and links to the full page.

const ACTIVITY_LIMIT = 10;

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

export async function RecentActivity({ userId }: { userId: string }) {
  const t = await getTranslations("home_v2");
  const { rows } = await loadActivityRows({
    userId,
    limit: ACTIVITY_LIMIT,
  });
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="recent-activity"
      className="mt-10 border-t border-[hsl(var(--border)/0.6)] pt-6"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h2
            id="recent-activity"
            className="text-[14px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]"
          >
            {t("activity_heading")}
          </h2>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("activity_caption")}
          </p>
        </div>
        <Link
          href="/app/activity"
          className="text-[12px] font-medium text-[hsl(var(--muted-foreground))] underline-offset-4 hover:text-[hsl(var(--foreground))] hover:underline"
        >
          {t("activity_view_all")}
        </Link>
      </header>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind] ?? Activity;
          const verb = t(`activity_action_label.${row.kind}`);
          return (
            <li
              key={row.id}
              className="flex items-center gap-2.5 border-b border-[hsl(var(--border)/0.4)] py-1.5 text-[12px] last:border-b-0"
            >
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[hsl(var(--muted-foreground))]"
              >
                <Icon size={12} strokeWidth={1.75} />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {verb}
              </span>
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
                {row.primary}
              </span>
              <time
                dateTime={row.occurredAt.toISOString()}
                title={row.occurredAt.toLocaleString()}
                className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
              >
                {shortRelative(row.occurredAt)}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shortRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
