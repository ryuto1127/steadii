import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { assignments as assignmentsTable, classes as classesTable } from "@/lib/db/schema";
import { CommandPalette } from "@/components/chat/command-palette";
import { QueueList } from "@/components/agent/queue-list";
import { QueueEmptyState } from "@/components/agent/queue-empty-state";
import { TodayBriefing } from "@/components/agent/today-briefing";
import { RecentActivity } from "@/components/agent/recent-activity";
import { buildQueueForUser } from "@/lib/agent/queue/build";
import {
  getDueSoonAssignments,
  getTodaysEvents,
  todayDateInTz,
} from "@/lib/dashboard/today";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ, addDaysToDateStr, localMidnightAsUtc } from "@/lib/calendar/tz-utils";
import { fetchUpcomingTasks } from "@/lib/integrations/google/tasks";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import {
  queueConfirmAction,
  queueCorrectAction,
  queueDismissAction,
  queuePermanentDismissAction,
  queueResolveProposalAction,
  queueSecondaryAction,
  queueSendOfficeHoursAction,
  queueSnoozeAction,
  queueSubmitClarificationAction,
} from "./queue-actions";

export const dynamic = "force-dynamic";

function greetingKey(h: number): "morning" | "afternoon" | "evening" | "night" {
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("home");
  const locale = await getLocale();

  // One round-trip burst — every panel that needs DB reads is parallel.
  const [
    queueCards,
    events,
    dueSoon,
    todayTasks,
    tzPref,
  ] = await Promise.all([
    buildQueueForUser(userId, locale),
    getTodaysEvents(userId),
    getDueSoonAssignments(userId, 168),
    fetchTodayTasks(userId),
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
  const greeting = t(
    `greeting_${greetingKey(Number.isNaN(userHour) ? now.getHours() : userHour)}`,
    { name: firstName }
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-5 sm:px-6 md:px-10 md:py-8">
      <header className="steadii-greeting-enter mb-6 flex flex-col gap-1.5 md:mb-8">
        <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] sm:text-[28px] md:text-[32px]">
          {greeting}
        </h1>
        <p className="text-[14px] text-[hsl(var(--muted-foreground))] md:text-[15px]">
          {t("summary_ready")}
        </p>
      </header>

      <div data-command-palette className="mb-8">
        <CommandPalette autoFocus />
      </div>

      {/* Today briefing surfaces ABOVE the queue per Ryuto's lock 2026-05-01:
          calendar / tasks / deadlines are universal context the user must
          see at a glance every visit. The queue (decisions / drafts /
          notices) sits below — it's important but action-oriented, and
          requires more attention than a quick scan. */}
      <TodayBriefing
        events={events}
        todayTasks={todayTasks}
        upcomingDeadlines={dueSoon}
        tz={tz}
      />

      <div className="mt-10 md:mt-12">
        {queueCards.length > 0 ? (
          <QueueList
            cards={queueCards}
            actions={{
              resolveProposal: queueResolveProposalAction,
              submitClarification: queueSubmitClarificationAction,
              dismiss: queueDismissAction,
              snooze: queueSnoozeAction,
              permanentDismiss: queuePermanentDismissAction,
              secondaryAction: queueSecondaryAction,
              sendOfficeHours: queueSendOfficeHoursAction,
              confirm: queueConfirmAction,
              correct: queueCorrectAction,
            }}
          />
        ) : (
          <QueueEmptyState />
        )}
      </div>

      <div className="mt-10 md:mt-12">
        <RecentActivity userId={userId} />
      </div>
    </div>
  );
}

// Today + 7-day window, source-aware. Engineer-37 widened the window
// from "today only" to "today + next 7 days" so the home briefing
// surfaces a real week-ahead view, and added a `kind` discriminator
// so the one-click checkbox can route a complete back to the right
// provider (Steadii DB / Google Tasks / Microsoft To Do).
//
// Pulls from THREE sources for /app/tasks parity:
//   1. Steadii assignments (DB, canonical academic-deadline store)
//   2. Google Tasks (live)
//   3. Microsoft To Do (live, when connected)
export type TodayTask =
  | {
      kind: "steadii";
      id: string;
      title: string;
      classTitle: string | null;
      due: string | null; // YYYY-MM-DD, local-date-only; null when no due
    }
  | {
      kind: "google";
      taskId: string;
      taskListId: string;
      title: string;
      due: string; // YYYY-MM-DD
    }
  | {
      kind: "microsoft";
      taskId: string;
      taskListId: string;
      title: string;
      due: string; // YYYY-MM-DD
    };

async function fetchTodayTasks(userId: string): Promise<TodayTask[]> {
  const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
  const today = todayDateInTz(tz);
  // Engineer-37: widen the upper bound from +1d to +7d so a real
  // week-ahead horizon surfaces. The merge helper still keeps overdue
  // external rows, so the visible window is "overdue → 7 days out".
  const end = localMidnightAsUtc(addDaysToDateStr(today, 7), tz);

  const [steadiiRows, googleTasks, msTasks] = await Promise.all([
    db
      .select({
        id: assignmentsTable.id,
        title: assignmentsTable.title,
        classTitle: classesTable.name,
        dueAt: assignmentsTable.dueAt,
      })
      .from(assignmentsTable)
      .leftJoin(classesTable, eq(classesTable.id, assignmentsTable.classId))
      .where(
        and(
          eq(assignmentsTable.userId, userId),
          isNull(assignmentsTable.deletedAt),
          ne(assignmentsTable.status, "done"),
          // Drop the lower bound — show every still-pending assignment
          // whose due date has either arrived or already passed, not
          // just today's. Overdue items deserve top-of-mind treatment.
          lte(assignmentsTable.dueAt, end)
        )
      )
      .orderBy(asc(assignmentsTable.dueAt))
      .limit(25),
    // External fetchers soft-fail when the integration isn't connected;
    // .catch keeps a single broken provider from blanking today's
    // briefing for the user. `daysBack: 30` opens the API filter so
    // overdue tasks (still-pending past-due items) are returned, then
    // mergeTodayTasks's `task.due <= weekEnd` filter narrows to
    // overdue → 7 days out. Without daysBack, the API's dueMin sits
    // at today UTC and overdue items never make it to the client.
    fetchUpcomingTasks(userId, { days: 7, daysBack: 30, max: 50 }).catch(
      () => []
    ),
    fetchMsUpcomingTasks(userId, { days: 7, daysBack: 30, max: 50 }).catch(
      () => []
    ),
  ]);

  return mergeTodayTasks(
    steadiiRows.map((r) => ({
      id: r.id,
      title: r.title,
      classTitle: r.classTitle ?? null,
      due: r.dueAt ? r.dueAt.toISOString().slice(0, 10) : null,
    })),
    googleTasks,
    msTasks,
    today,
    addDaysToDateStr(today, 7)
  );
}

// Pure helper — extracted so the merge logic can be unit-tested
// without mocking three sources of side-effects. Filters external
// tasks to "overdue → next 7 days" so the home briefing surfaces
// every task in the user's week-ahead horizon plus anything still
// pending and past due.
export function mergeTodayTasks(
  steadii: Array<{
    id: string;
    title: string;
    classTitle: string | null;
    due: string | null;
  }>,
  google: Array<{
    due: string;
    title: string;
    taskId: string;
    taskListId: string;
  }>,
  ms: Array<{
    due: string;
    title: string;
    taskId: string;
    taskListId: string;
  }>,
  todayStr: string,
  weekEndStr?: string,
  limit: number = 25
): TodayTask[] {
  // Default to today if no upper bound supplied — preserves prior
  // "today + overdue" semantics for callers that haven't migrated.
  const upper = weekEndStr ?? todayStr;
  const out: TodayTask[] = [
    ...steadii.map(
      (r): TodayTask => ({
        kind: "steadii",
        id: r.id,
        title: r.title,
        classTitle: r.classTitle,
        due: r.due,
      })
    ),
    ...google
      .filter((t) => t.due <= upper)
      .map(
        (t): TodayTask => ({
          kind: "google",
          taskId: t.taskId,
          taskListId: t.taskListId,
          title: t.title,
          due: t.due,
        })
      ),
    ...ms
      .filter((t) => t.due <= upper)
      .map(
        (t): TodayTask => ({
          kind: "microsoft",
          taskId: t.taskId,
          taskListId: t.taskListId,
          title: t.title,
          due: t.due,
        })
      ),
  ];
  return out.slice(0, limit);
}
