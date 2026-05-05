import Link from "next/link";
import { Activity, Archive, CheckCircle2, Mail, X } from "lucide-react";
import type { ActivityKind, ActivityRow } from "@/lib/activity/load";

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

// Day-grouped timeline. Each group renders the localized day header
// ("Today" / "Yesterday" / "Wed May 1") with the rows beneath.
//
// Pure presentation — page passes pre-rendered groups + per-row label
// strings. Pagination is handled by the parent's <ActivityLoadMore />
// client component, which appends additional <ActivityTimelineGroup />
// nodes.
export function ActivityTimeline({
  groups,
  actionLabels,
}: {
  groups: TimelineGroup[];
  actionLabels: Record<ActivityKind, string>;
}) {
  return (
    <ol className="flex flex-col gap-6">
      {groups.map((g) => (
        <TimelineGroupView
          key={g.dayKey}
          group={g}
          actionLabels={actionLabels}
        />
      ))}
    </ol>
  );
}

export type TimelineGroup = {
  dayKey: string;
  dayHeading: string;
  rows: ActivityRow[];
};

function TimelineGroupView({
  group,
  actionLabels,
}: {
  group: TimelineGroup;
  actionLabels: Record<ActivityKind, string>;
}) {
  return (
    <li>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
        {group.dayHeading}
      </div>
      <ul className="flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
        {group.rows.map((row) => {
          const Icon = KIND_ICON[row.kind] ?? Activity;
          const verb = actionLabels[row.kind] ?? actionLabels.generic;
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
                dateTime={row.occurredAt.toISOString()}
                title={row.occurredAt.toLocaleString()}
                className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]"
              >
                {shortTimeOfDay(row.occurredAt)}
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
    </li>
  );
}

function shortTimeOfDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase()
    .replace(/\s/g, "");
}

// Group a flat row list into day buckets in the user's local timezone.
// "Today"/"Yesterday" headings are produced by the caller (locale-aware
// via getTranslations); we just provide the day key + a default heading
// for older days.
export function groupByDay(
  rows: ActivityRow[],
  opts: {
    todayLabel: string;
    yesterdayLabel: string;
    locale: string;
    timezone?: string;
  }
): TimelineGroup[] {
  const tz = opts.timezone || undefined;
  const now = new Date();
  const todayKey = ymdInTz(now, tz);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = ymdInTz(yesterday, tz);
  const groups = new Map<string, TimelineGroup>();
  for (const row of rows) {
    const dayKey = ymdInTz(row.occurredAt, tz);
    let g = groups.get(dayKey);
    if (!g) {
      const heading =
        dayKey === todayKey
          ? opts.todayLabel
          : dayKey === yesterdayKey
            ? opts.yesterdayLabel
            : new Intl.DateTimeFormat(opts.locale, {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: tz,
              }).format(row.occurredAt);
      g = { dayKey, dayHeading: heading, rows: [] };
      groups.set(dayKey, g);
    }
    g.rows.push(row);
  }
  return Array.from(groups.values());
}

function ymdInTz(d: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
  return parts;
}
