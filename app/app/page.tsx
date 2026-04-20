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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function todayLabel(): string {
  const d = new Date();
  return `TODAY · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function pastWeekLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return `${mm}/${dd}`;
  };
  return `PAST WEEK · ${fmt(startIso)} — ${fmt(endIso)}`;
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-6">
      <div className="grid gap-5 md:grid-cols-3">
        {/* TODAY */}
        <DashboardCard label={todayLabel()}>
          {events.length === 0 ? (
            <GhostTimeline message={t("no_events")} />
          ) : (
            <ul className="space-y-1">
              {events.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 text-body text-[hsl(var(--foreground))]"
                >
                  <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatTimeRange(e.start, e.end)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.calendarName ? (
                    <span className="truncate text-small text-[hsl(var(--muted-foreground))]">
                      {e.calendarName}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* DUE */}
        <DashboardCard label="DUE · NEXT 72H">
          {dueSoon.length === 0 ? (
            <div className="fade-in flex min-h-[6.5rem] items-center justify-center text-small text-[hsl(var(--muted-foreground))]">
              — {t("nothing_due")} —
            </div>
          ) : (
            <ul className="space-y-1">
              {dueSoon.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 text-body text-[hsl(var(--foreground))]"
                >
                  <ClassDot color={a.classColor} />
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatRelativeDue(a.due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* PAST WEEK */}
        <DashboardCard
          label={pastWeekLabel(weekSummary.window.start, weekSummary.window.end)}
        >
          {weekSummary.empty ? (
            <div className="fade-in flex min-h-[6.5rem] items-center justify-center text-small text-[hsl(var(--muted-foreground))]">
              — {t("not_enough_history")} —
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="text-body tabular-nums">
                {t("counts", {
                  chats: String(weekSummary.counts.chats),
                  mistakes: String(weekSummary.counts.mistakes),
                  syllabi: String(weekSummary.counts.syllabi),
                })}
              </div>
              {weekSummary.pattern ? (
                <p className="text-small text-[hsl(var(--muted-foreground))]">
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
