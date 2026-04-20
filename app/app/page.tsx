import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { NewChatInput } from "@/components/chat/new-chat-input";
import { ActionPill } from "@/components/ui/action-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ClassDot } from "@/components/ui/class-dot";
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

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const notion = await getNotionClientForUser(userId);
  const hasAnyClass = Boolean(notion?.connection.classesDbId);

  if (!hasAnyClass) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8 py-10">
        <EmptyState
          icon={<GraduationCap size={18} strokeWidth={1.5} />}
          title="Welcome to Steadii"
          description={
            <>
              <div>Steady through the semester.</div>
              <div className="mt-3">
                Connect your first class to start seeing today&apos;s schedule,
                due assignments, and recent activity.
              </div>
            </>
          }
          actions={[
            { label: "+ Add your first class", href: "/app/classes" },
          ]}
        />
        <div className="mx-auto w-full max-w-2xl">
          <NewChatInput placeholder="or paste a syllabus, image, or ask anything…" />
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
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-6">
      <div className="grid gap-4 md:grid-cols-3">
        <DashboardCard title="Today's schedule">
          {events.length === 0 ? null : (
            <ul className="space-y-1">
              {events.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 text-small text-[hsl(var(--foreground))]"
                >
                  <span className="font-mono text-[13px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatTimeRange(e.start, e.end)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.calendarName ? (
                    <span className="truncate text-[hsl(var(--muted-foreground))]">
                      {e.calendarName}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {events.length === 0 ? (
            <p className="py-4 text-small text-[hsl(var(--muted-foreground))]">
              No classes or events today.
            </p>
          ) : null}
        </DashboardCard>

        <DashboardCard title="Due soon">
          {dueSoon.length === 0 ? null : (
            <ul className="space-y-1">
              {dueSoon.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 text-small text-[hsl(var(--foreground))]"
                >
                  <ClassDot color={a.classColor} />
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="font-mono text-[13px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {formatRelativeDue(a.due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {dueSoon.length === 0 ? (
            <p className="py-4 text-small text-[hsl(var(--muted-foreground))]">
              Nothing due. You&apos;re clear.
            </p>
          ) : null}
        </DashboardCard>

        <DashboardCard title="Past week">
          {weekSummary.empty ? (
            <p className="py-4 text-small text-[hsl(var(--muted-foreground))]">
              Not enough history yet. Come back next week.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                {formatDateMD(weekSummary.window.start)} — {formatDateMD(weekSummary.window.end)}
              </div>
              <div className="text-small">
                <span className="tabular-nums">{weekSummary.counts.chats}</span> chats ·{" "}
                <span className="tabular-nums">{weekSummary.counts.mistakes}</span> mistakes ·{" "}
                <span className="tabular-nums">{weekSummary.counts.syllabi}</span> syllabi
              </div>
              {weekSummary.pattern ? (
                <p className="text-small text-[hsl(var(--muted-foreground))]">
                  {weekSummary.pattern}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <ReviewPill />
                <GeneratePracticePill />
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

function formatDateMD(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function ReviewPill() {
  return (
    <form action="/api/chat/seeded" method="post">
      <input type="hidden" name="seed" value="review_recent_mistakes" />
      <ActionPill tone="primary" type="submit">
        復習する
      </ActionPill>
    </form>
  );
}

function GeneratePracticePill() {
  return (
    <form action="/api/chat/seeded" method="post">
      <input type="hidden" name="seed" value="generate_similar_problems" />
      <ActionPill type="submit">練習問題を生成</ActionPill>
    </form>
  );
}
