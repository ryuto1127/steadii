import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
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
import {
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

  // One round-trip burst — every panel that needs DB reads is parallel.
  const [
    queueCards,
    events,
    dueSoon,
    todayTasks,
    tzPref,
  ] = await Promise.all([
    buildQueueForUser(userId),
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
          }}
        />
      ) : (
        <QueueEmptyState />
      )}

      <RecentActivity userId={userId} />
    </div>
  );
}

// Tasks due *today* — narrower than the 72h dueSoon window. Reads
// directly here to avoid widening the dashboard helper API for what's
// essentially a one-call need.
async function fetchTodayTasks(userId: string): Promise<
  Array<{ id: string; title: string; classTitle: string | null }>
> {
  const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
  const today = todayDateInTz(tz);
  const start = localMidnightAsUtc(today, tz);
  const end = localMidnightAsUtc(addDaysToDateStr(today, 1), tz);
  const rows = await db
    .select({
      id: assignmentsTable.id,
      title: assignmentsTable.title,
      classTitle: classesTable.name,
    })
    .from(assignmentsTable)
    .leftJoin(classesTable, eq(classesTable.id, assignmentsTable.classId))
    .where(
      and(
        eq(assignmentsTable.userId, userId),
        isNull(assignmentsTable.deletedAt),
        ne(assignmentsTable.status, "done"),
        gte(assignmentsTable.dueAt, start),
        lte(assignmentsTable.dueAt, end)
      )
    )
    .orderBy(asc(assignmentsTable.dueAt))
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    classTitle: r.classTitle ?? null,
  }));
}
