import { Calendar, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  formatTimeRange,
  type DueSoonAssignment,
  type TodayEvent,
} from "@/lib/dashboard/today";
import { todayDateInTz } from "@/lib/dashboard/today";
import { addDaysToDateStr } from "@/lib/calendar/tz-utils";
import type { TodayTask } from "@/app/app/page";
import { TodayTasksList } from "./today-tasks-list";
import { cn } from "@/lib/utils/cn";

const ROW_CAP = 5;

// Today + 7-day briefing — supporting context below the queue. The queue
// is the star; this strip restates the week's calendar / tasks / next
// deadlines in low-contrast triangular columns. Engineer-37 widened the
// horizon from "today only" to "today + next 7 days" with day grouping
// when entries span multiple days, plus a "+ N more this week" footer
// when the per-pane cap is exceeded.
export async function TodayBriefing({
  events,
  todayTasks,
  upcomingDeadlines,
  tz,
}: {
  events: TodayEvent[];
  todayTasks: TodayTask[];
  upcomingDeadlines: DueSoonAssignment[];
  tz: string;
}) {
  const t = await getTranslations("home_v2");
  const locale = await getLocale();
  const todayStr = todayDateInTz(tz);
  const tomorrowStr = addDaysToDateStr(todayStr, 1);

  const eventsVisible = events.slice(0, ROW_CAP);
  const eventsOverflow = Math.max(0, events.length - ROW_CAP);
  const eventGroups = groupEventsByDay(eventsVisible, tz);
  const showEventGroups = eventGroups.length > 1;

  const todayLabel = t("day_today");
  const tomorrowLabel = t("day_tomorrow");

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
        hasContent={events.length > 0}
      >
        <ul className="flex flex-col gap-1">
          {eventGroups.map((group) => (
            <DayGroup
              key={group.dayKey}
              showHeading={showEventGroups}
              headingLabel={dayHeading(
                group.dayKey,
                todayStr,
                tomorrowStr,
                todayLabel,
                tomorrowLabel,
                locale,
              )}
            >
              {group.events.map((e) => (
                <Row
                  key={e.id}
                  primary={e.title}
                  secondary={formatTimeRange(e.start, e.end, tz)}
                />
              ))}
            </DayGroup>
          ))}
          {eventsOverflow > 0 ? (
            <li className="pt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("more_this_week", { n: eventsOverflow })}
            </li>
          ) : null}
        </ul>
      </Pane>
      <Pane
        icon={<CheckCircle2 size={14} strokeWidth={1.75} />}
        heading={t("today_tasks_heading")}
        href="/app/tasks"
        empty={t("today_no_tasks")}
        hasContent={todayTasks.length > 0}
      >
        <TodayTasksList
          tasks={todayTasks}
          cap={ROW_CAP}
          todayStr={todayStr}
          tomorrowStr={tomorrowStr}
        />
      </Pane>
      <Pane
        icon={<Clock size={14} strokeWidth={1.75} />}
        heading={t("today_deadlines_heading")}
        href="/app/calendar"
        empty={t("today_no_deadlines")}
        hasContent={upcomingDeadlines.length > 0}
      >
        <ul className="flex flex-col gap-1">
          {upcomingDeadlines.slice(0, ROW_CAP).map((d) => (
            <Row
              key={d.id}
              primary={d.title}
              secondary={formatRelativeDue(d.due, tz)}
            />
          ))}
          {upcomingDeadlines.length > ROW_CAP ? (
            <li className="pt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("more_this_week", {
                n: upcomingDeadlines.length - ROW_CAP,
              })}
            </li>
          ) : null}
        </ul>
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
  hasContent,
}: {
  icon: React.ReactNode;
  heading: string;
  href?: string;
  children: React.ReactNode;
  empty: string;
  hasContent: boolean;
}) {
  const Inner = (
    <div className="flex flex-col gap-1.5">
      <header className="flex items-center gap-1.5">
        <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
          {heading}
        </h3>
      </header>
      {hasContent ? (
        children
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

function DayGroup({
  showHeading,
  headingLabel,
  children,
}: {
  showHeading: boolean;
  headingLabel: string;
  children: React.ReactNode;
}) {
  if (!showHeading) return <>{children}</>;
  return (
    <>
      <li
        className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]"
        aria-hidden
      >
        {headingLabel}
      </li>
      {children}
    </>
  );
}

function groupEventsByDay(
  events: TodayEvent[],
  tz: string,
): Array<{ dayKey: string; events: TodayEvent[] }> {
  const buckets = new Map<string, TodayEvent[]>();
  for (const e of events) {
    const dayKey = dayKeyForIso(e.start, tz);
    const list = buckets.get(dayKey) ?? [];
    list.push(e);
    buckets.set(dayKey, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, evs]) => ({ dayKey, events: evs }));
}

// "YYYY-MM-DD" key in the user's tz from an ISO timestamp. Crucial:
// new Date(iso).toISOString().slice(0,10) would give UTC, which shifts
// Vancouver evenings into tomorrow.
function dayKeyForIso(iso: string, tz: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function dayHeading(
  dayKey: string,
  todayStr: string,
  tomorrowStr: string,
  todayLabel: string,
  tomorrowLabel: string,
  locale: string,
): string {
  if (dayKey === todayStr) return todayLabel;
  if (dayKey === tomorrowStr) return tomorrowLabel;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Day-of-week in the user's locale. Cheap, stable.
  let dow = "";
  try {
    dow = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
      new Date(`${dayKey}T00:00:00`),
    );
  } catch {
    dow = "";
  }
  return dow ? `${month}/${day} ${dow}` : `${month}/${day}`;
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
