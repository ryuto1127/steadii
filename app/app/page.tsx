import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { NewChatInput } from "@/components/chat/new-chat-input";
import { ActionPill } from "@/components/ui/action-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ClassDot } from "@/components/ui/class-dot";
import { GhostTimeline } from "@/components/ui/ghost-timeline";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";
import { computeWeekSummary } from "@/lib/agent/tools/summarize-week";
import {
  getDueSoonAssignments,
  getTodaysEvents,
  formatRelativeDue,
  formatTimeRange,
} from "@/lib/dashboard/today";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

function todaySubtitle(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function dueSubtitle(): string {
  const from = new Date();
  const to = new Date(from.getTime() + 72 * 60 * 60 * 1000);
  return `${formatMD(from)} — ${formatMD(to)}`;
}

function pastWeekSubtitle(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "";
  return `${formatMD(new Date(startIso))} — ${formatMD(new Date(endIso))}`;
}

function formatMD(d: Date): string {
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${mm}/${dd}`;
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("home");

  const notion = await getNotionClientForUser(userId);
  const hasAnyClass = Boolean(notion?.connection.classesDbId);

  if (!hasAnyClass) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
        <EmptyState
          icon={<GraduationCap size={18} strokeWidth={1.5} />}
          title={t("welcome_title")}
          description={<div>{t("welcome_body")}</div>}
          actions={[{ label: t("add_first_class"), href: "/app/classes" }]}
        />
        <div className="mx-auto w-full max-w-2xl">
          <NewChatInput placeholder={t("welcome_input_placeholder")} />
        </div>
      </div>
    );
  }

  const [events, dueSoon, weekSummary] = await Promise.all([
    getTodaysEvents(userId),
    getDueSoonAssignments(userId),
    computeWeekSummary(userId),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div className="grid gap-8 md:grid-cols-3">
        {/* Today */}
        <DashboardCard title={t("today_schedule")} subtitle={todaySubtitle()}>
          {events.length === 0 ? (
            <GhostTimeline message={t("no_events")} />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 text-[14px] text-[hsl(var(--foreground))]"
                >
                  <span className="w-[84px] shrink-0 font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatTimeRange(e.start, e.end)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* Due soon */}
        <DashboardCard title={t("due_soon")} subtitle={dueSubtitle()}>
          {dueSoon.length === 0 ? (
            <p className="fade-in text-[14px] text-[hsl(var(--muted-foreground))]">
              {t("nothing_due")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dueSoon.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 text-[14px] text-[hsl(var(--foreground))]"
                >
                  <ClassDot color={a.classColor} />
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatRelativeDue(a.due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* Past week */}
        <DashboardCard
          title={t("past_week")}
          subtitle={pastWeekSubtitle(
            weekSummary.window.start,
            weekSummary.window.end
          )}
        >
          {weekSummary.empty ? (
            <p className="fade-in text-[14px] text-[hsl(var(--muted-foreground))]">
              {t("not_enough_history")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[14px] tabular-nums text-[hsl(var(--foreground))]">
                {t("counts", {
                  chats: String(weekSummary.counts.chats),
                  mistakes: String(weekSummary.counts.mistakes),
                  syllabi: String(weekSummary.counts.syllabi),
                })}
              </p>
              {weekSummary.pattern ? (
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                  {weekSummary.pattern}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <SeedPill
                  seed="review_recent_mistakes"
                  label={t("review_action")}
                  tone="primary"
                />
                <SeedPill
                  seed="generate_similar_problems"
                  label={t("generate_practice_action")}
                />
              </div>
            </div>
          )}
        </DashboardCard>
      </div>

      <div className="mx-auto w-full max-w-2xl">
        <NewChatInput autoFocus />
      </div>
    </div>
  );
}

function SeedPill({
  seed,
  label,
  tone,
}: {
  seed: string;
  label: string;
  tone?: "primary" | "neutral";
}) {
  return (
    <form action="/api/chat/seeded" method="post">
      <input type="hidden" name="seed" value={seed} />
      <ActionPill tone={tone} type="submit">
        {label}
      </ActionPill>
    </form>
  );
}
