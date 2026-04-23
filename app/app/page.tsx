import Link from "next/link";
import { Calendar, Clock, TrendingUp, ChevronRight, CheckCircle2 } from "lucide-react";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewChatInput } from "@/components/chat/new-chat-input";
import { computeWeekSummary } from "@/lib/agent/tools/summarize-week";
import {
  getDueSoonAssignments,
  getTodaysEvents,
  formatTimeRange,
  type TodayEvent,
  type DueSoonAssignment,
} from "@/lib/dashboard/today";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

function greetingKey(h: number): "morning" | "afternoon" | "evening" | "night" {
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function formatCardDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const mo = parts.find((p) => p.type === "month")?.value.toUpperCase() ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${mo} ${day}, ${year}`;
}

function ymdInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

function formatRelativeDueLong(iso: string, tz: string): string {
  if (!iso) return "";
  const now = new Date();
  const due = new Date(iso);
  const nowYmd = ymdInTz(now, tz);
  const dueYmd = ymdInTz(due, tz);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowYmd = ymdInTz(tomorrowDate, tz);
  const time = due.toLocaleTimeString([], {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  if (nowYmd === dueYmd) return `TODAY, ${time.toUpperCase()}`;
  if (tomorrowYmd === dueYmd) return `TOMORROW, ${time.toUpperCase()}`;
  const weekday = due
    .toLocaleDateString("en-US", { timeZone: tz, weekday: "short" })
    .toUpperCase();
  const mo = due
    .toLocaleDateString("en-US", { timeZone: tz, month: "short" })
    .toUpperCase();
  const day = due.toLocaleDateString("en-US", { timeZone: tz, day: "numeric" });
  return `${weekday} ${mo} ${day}`;
}

function countDueToday(items: DueSoonAssignment[], tz: string): number {
  const todayYmd = ymdInTz(new Date(), tz);
  return items.filter((a) => {
    if (!a.due) return false;
    return ymdInTz(new Date(a.due), tz) === todayYmd;
  }).length;
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("home");

  // Phase 6: Notion is optional. The dashboard always renders its three
  // cards; each card handles its own empty state (Today uses Calendar so
  // it works without Notion; Due soon and Past week degrade to empty).
  const [events, dueSoon, weekSummary, tzPref] = await Promise.all([
    getTodaysEvents(userId),
    getDueSoonAssignments(userId),
    computeWeekSummary(userId),
    getUserTimezone(userId),
  ]);
  const tz = tzPref ?? FALLBACK_TZ;

  const firstName =
    session.user.name?.trim().split(/\s+/)[0] ||
    session.user.email?.split("@")[0] ||
    "there";
  const now = new Date();
  const userHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    })
      .format(now)
      .replace(/[^0-9]/g, "")
  );
  const greeting = t(`greeting_${greetingKey(Number.isNaN(userHour) ? now.getHours() : userHour)}`, {
    name: firstName,
  });

  const dueTodayCount = countDueToday(dueSoon, tz);
  const sessionsCount = weekSummary.counts.chats;

  return (
    <div className="relative isolate mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col overflow-hidden">
      {/* Chromatic cloud — centered behind the dashboard, heavily blurred
          and low-opacity so it reads as ambient warmth rather than a
          discrete object. `isolate` on the parent pins its stacking
          context (so -z-10 doesn't fall behind the body bg and flash on
          hydration); `overflow-hidden` clips the 820px span to the
          container so the edges don't bleed outside the dashboard area. */}
      <span
        aria-hidden
        className="steadii-cloud -z-10"
        style={{ top: "40px", left: "calc(50% - 410px)" }}
      />
      <header className="steadii-greeting-enter relative z-0 mb-10 flex flex-col gap-2">
        <h1 className="font-display text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))]">
          {greeting}
        </h1>
        <p className="text-[17px] text-[hsl(var(--muted-foreground))]">
          {t("summary_ready")}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <TodayCard
          events={events}
          tz={tz}
          noEventsLabel={t("no_events")}
          fullCalendarLabel={t("full_calendar")}
          title={t("today_schedule")}
        />
        <DueCard
          items={dueSoon}
          tz={tz}
          nothingDueLabel={t("nothing_due")}
          remainingLabel={t("assignments_remaining", { count: dueTodayCount })}
          title={t("due_soon")}
        />
        <PastWeekCard
          sessions={sessionsCount}
          sessionsLabel={t("study_sessions")}
          title={t("past_week")}
          pattern={weekSummary.pattern}
          emptyLabel={t("focus_summary_empty")}
          reviewLabel={t("review_action")}
          practiceLabel={t("generate_practice_action")}
          isEmpty={weekSummary.empty}
        />
      </div>

      <div className="mx-auto mt-auto w-full max-w-3xl pt-16">
        <NewChatInput autoFocus />
      </div>
    </div>
  );
}

function BentoCard({
  icon,
  iconTint,
  topRight,
  label,
  children,
  className,
}: {
  icon: React.ReactNode;
  iconTint: "indigo" | "amber" | "violet";
  topRight?: React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  // Pastel-candy icon tiles — softer and lighter than before, so each
  // tile reads like a colored lozenge rather than a filled button.
  const tintBg = {
    indigo:
      "bg-[rgba(219,234,254,0.55)] text-[hsl(217_91%_55%)] dark:bg-[hsl(217_70%_20%)] dark:text-[hsl(217_90%_78%)]",
    amber:
      "bg-[rgba(255,237,213,0.65)] text-[hsl(21_90%_48%)] dark:bg-[hsl(28_60%_20%)] dark:text-[hsl(32_92%_68%)]",
    violet:
      "bg-[rgba(243,232,255,0.65)] text-[hsl(271_81%_56%)] dark:bg-[hsl(268_45%_22%)] dark:text-[hsl(268_80%_80%)]",
  }[iconTint];

  return (
    <section
      className={cn(
        "steadii-card-enter group flex flex-col gap-5 rounded-3xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface-raised))] p-6 transition-default hover:border-[hsl(var(--border))] hover:shadow-[0_14px_36px_-18px_rgba(0,0,0,0.12)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-2xl",
            tintBg
          )}
        >
          {icon}
        </span>
        {topRight}
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function TodayCard({
  events,
  tz,
  noEventsLabel,
  fullCalendarLabel,
  title,
}: {
  events: TodayEvent[];
  tz: string;
  noEventsLabel: string;
  fullCalendarLabel: string;
  title: string;
}) {
  const dateLabel = formatCardDate(new Date(), tz);
  const visible = events.slice(0, 2);
  return (
    <BentoCard
      icon={<Calendar size={18} strokeWidth={1.75} />}
      iconTint="indigo"
      label={title}
      topRight={
        <span className="font-mono text-[10px] font-medium tabular-nums tracking-wider text-[hsl(var(--muted-foreground))]">
          {dateLabel}
        </span>
      }
    >
      {events.length === 0 ? (
        <p className="fade-in text-[13px] text-[hsl(var(--muted-foreground))]">
          {noEventsLabel}
        </p>
      ) : (
        <ul className="flex flex-col">
          {visible.map((e, i) => (
            <li
              key={e.id}
              className={cn(
                "flex items-start gap-4 py-3",
                i > 0 && "border-t border-[hsl(var(--border)/0.6)]"
              )}
            >
              <span className="w-[44px] shrink-0 pt-0.5 font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                {formatTimeRange(e.start, e.end, tz).split(" — ")[0] ?? ""}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-medium text-[hsl(var(--foreground))]">
                  {e.title}
                </span>
                {e.location ? (
                  <span className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                    {e.location}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/app/calendar"
        className="group/btn mt-auto inline-flex items-center gap-1 pt-4 text-[12px] font-medium text-[hsl(var(--foreground))] transition-hover hover:opacity-70"
      >
        {fullCalendarLabel}
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className="transition-transform group-hover/btn:translate-x-0.5"
        />
      </Link>
    </BentoCard>
  );
}

function DueCard({
  items,
  tz,
  nothingDueLabel,
  remainingLabel,
  title,
}: {
  items: DueSoonAssignment[];
  tz: string;
  nothingDueLabel: string;
  remainingLabel: string;
  title: string;
}) {
  const visible = items.slice(0, 2);
  const todayCount = countDueToday(items, tz);
  const progressPct = items.length === 0
    ? 0
    : Math.min(100, Math.round((todayCount / items.length) * 100));
  return (
    <BentoCard
      icon={<Clock size={18} strokeWidth={1.75} />}
      iconTint="amber"
      label={title}
      topRight={
        items.length > 0 ? (
          <div className="flex -space-x-1.5">
            {items.slice(0, 2).map((a) => (
              <span
                key={a.id}
                aria-hidden
                className="h-6 w-6 rounded-full border-2 border-[hsl(var(--surface))] bg-[hsl(var(--surface-raised))]"
              />
            ))}
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="fade-in text-[13px] text-[hsl(var(--muted-foreground))]">
          {nothingDueLabel}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {visible.map((a) => {
              const dueSoon =
                a.due &&
                new Date(a.due).getTime() - Date.now() < 24 * 60 * 60 * 1000;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-[hsl(var(--foreground))]">
                        {a.title}
                      </span>
                      {dueSoon ? (
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
                        />
                      ) : null}
                    </span>
                    <span className="truncate font-mono text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      {formatRelativeDueLong(a.due, tz)}
                    </span>
                  </span>
                  <CheckCircle2
                    size={18}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-[hsl(var(--border))]"
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-auto flex flex-col gap-2 pt-5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[hsl(40_15%_92%)] dark:bg-white/5">
              <div
                className="steadii-bar-fill h-full rounded-full bg-[hsl(21_90%_55%)]"
                style={
                  {
                    "--target-width": `${progressPct}%`,
                  } as React.CSSProperties
                }
              />
            </div>
            <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
              {remainingLabel}
            </span>
          </div>
        </>
      )}
    </BentoCard>
  );
}

function PastWeekCard({
  sessions,
  sessionsLabel,
  title,
  pattern,
  emptyLabel,
  reviewLabel,
  practiceLabel,
  isEmpty,
}: {
  sessions: number;
  sessionsLabel: string;
  title: string;
  pattern: string;
  emptyLabel: string;
  reviewLabel: string;
  practiceLabel: string;
  isEmpty: boolean;
}) {
  return (
    <BentoCard
      icon={<TrendingUp size={18} strokeWidth={1.75} />}
      iconTint="violet"
      label={title}
    >
      {isEmpty ? (
        <p className="fade-in text-[13px] text-[hsl(var(--muted-foreground))]">
          {emptyLabel}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[38px] font-bold leading-none tracking-tight text-[hsl(268_70%_56%)] dark:text-[hsl(268_80%_78%)] tabular-nums">
              {sessions}
            </span>
            <span className="text-[12px] font-medium lowercase text-[hsl(var(--muted-foreground))]">
              {sessionsLabel}
            </span>
          </div>
          {pattern ? (
            <p className="mt-2 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
              {pattern}
            </p>
          ) : null}
          <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
            <SeedPill seed="review_recent_mistakes" label={reviewLabel} />
            <SeedPill seed="generate_similar_problems" label={practiceLabel} />
          </div>
        </>
      )}
    </BentoCard>
  );
}

function SeedPill({ seed, label }: { seed: string; label: string }) {
  return (
    <form action="/api/chat/seeded" method="post">
      <input type="hidden" name="seed" value={seed} />
      <button
        type="submit"
        className="flex w-full items-center justify-center rounded-xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface))] px-3 py-2.5 text-[12px] font-semibold text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        {label}
      </button>
    </form>
  );
}
