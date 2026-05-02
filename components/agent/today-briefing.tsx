import { Calendar, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  formatTimeRange,
  type DueSoonAssignment,
  type TodayEvent,
} from "@/lib/dashboard/today";
import { cn } from "@/lib/utils/cn";

// Today briefing — supporting context below the queue. The queue is the
// star; this strip restates the day's calendar / tasks / next deadlines
// in low-contrast triangular columns. Engineer choice (per spec):
// vertical list panes, not full bento cards.
export async function TodayBriefing({
  events,
  todayTasks,
  upcomingDeadlines,
  tz,
}: {
  events: TodayEvent[];
  todayTasks: Array<{ id: string; title: string; classTitle: string | null }>;
  upcomingDeadlines: DueSoonAssignment[];
  tz: string;
}) {
  const t = await getTranslations("home_v2");
  return (
    <section
      aria-labelledby="today-briefing"
      className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-5"
    >
      <h2 id="today-briefing" className="sr-only">
        {t("today_label")}
      </h2>
      <Pane
        icon={<Calendar size={14} strokeWidth={1.75} />}
        heading={t("today_calendar_heading")}
        href="/app/calendar"
        empty={t("today_no_events")}
      >
        {events.slice(0, 3).map((e) => (
          <Row
            key={e.id}
            primary={e.title}
            secondary={formatTimeRange(e.start, e.end, tz)}
          />
        ))}
      </Pane>
      <Pane
        icon={<CheckCircle2 size={14} strokeWidth={1.75} />}
        heading={t("today_tasks_heading")}
        href="/app/tasks"
        empty={t("today_no_tasks")}
      >
        {todayTasks.slice(0, 3).map((task) => (
          <Row
            key={task.id}
            primary={task.title}
            secondary={task.classTitle ?? undefined}
          />
        ))}
      </Pane>
      <Pane
        icon={<Clock size={14} strokeWidth={1.75} />}
        heading={t("today_deadlines_heading")}
        href="/app/calendar"
        empty={t("today_no_deadlines")}
      >
        {upcomingDeadlines.slice(0, 3).map((d) => (
          <Row
            key={d.id}
            primary={d.title}
            secondary={formatRelativeDue(d.due, tz)}
          />
        ))}
      </Pane>
    </section>
  );
}

function Pane({
  icon,
  heading,
  href,
  children,
  empty,
}: {
  icon: React.ReactNode;
  heading: string;
  href?: string;
  children: React.ReactNode;
  empty: string;
}) {
  // We render up to 3 rows; if the children array is empty React still
  // renders the flex container with 0 items, so we detect emptiness on
  // the children prop directly.
  const hasContent =
    Array.isArray(children) && children.filter(Boolean).length > 0;
  const Inner = (
    <div className="flex flex-col gap-1.5">
      <header className="flex items-center gap-1.5">
        <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
          {heading}
        </h3>
      </header>
      {hasContent ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <p className="text-[12px] italic text-[hsl(var(--muted-foreground))]">
          {empty}
        </p>
      )}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "group rounded-xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface-raised)/0.6)] p-4 transition-default hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]"
        )}
      >
        {Inner}
      </Link>
    );
  }
  return (
    <div className="rounded-xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface-raised)/0.6)] p-4">
      {Inner}
    </div>
  );
}

function Row({
  primary,
  secondary,
}: {
  primary: string;
  secondary?: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 flex-1 truncate text-[13px] text-[hsl(var(--foreground))]">
        {primary}
      </span>
      {secondary ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {secondary}
        </span>
      ) : null}
    </li>
  );
}

function formatRelativeDue(iso: string, _tz: string): string {
  if (!iso) return "";
  const due = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.round((due - now) / 60_000);
  if (mins < 0) return "overdue";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}
