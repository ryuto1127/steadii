import { redirect } from "next/navigation";
import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  classes as classesTable,
  users,
} from "@/lib/db/schema";
import { CommandPalette } from "@/components/chat/command-palette";
import { QueueList } from "@/components/agent/queue-list";
import { QueueEmptyState } from "@/components/agent/queue-empty-state";
import { TodayBriefing } from "@/components/agent/today-briefing";
import { RecentActivity } from "@/components/agent/recent-activity";
import { buildQueueForUser } from "@/lib/agent/queue/build";
import {
  BRIEFING_FORWARD_DAYS,
  BRIEFING_FORWARD_HOURS,
  getDueSoonAssignments,
  getTodaysEvents,
  todayDateInTz,
} from "@/lib/dashboard/today";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";
import { fetchUpcomingTasks } from "@/lib/integrations/google/tasks";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import {
  archiveProposalConfirmAllAction,
  archiveProposalDismissAllAction,
  autoCalProposalAddAction,
  autoCalProposalDismissAction,
  autoCalProposalEditAction,
  ignoreSenderAction,
  queueConfirmAction,
  queueCorrectAction,
  queueDismissAction,
  queueMarkHandledAction,
  queueMarkNotNeededAction,
  queuePermanentDismissAction,
  queueResolveProposalAction,
  queueSecondaryAction,
  queueCancelSendDraftAction,
  queueSendDraftAction,
  queueSendDraftAnywayAction,
  queueSendOfficeHoursAction,
  queueSetDispositionAction,
  queueSnoozeAction,
  queueSubmitClarificationAction,
  startClarificationChatAction,
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

  // Resolve the user's tz up front so the FORWARD-ONLY briefing loaders
  // (deadlines window) can anchor their lower/upper bounds in the user's
  // local day. Cheap single-column read; the heavy panels still run as a
  // parallel burst below.
  const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;

  // One round-trip burst — every panel that needs DB reads is parallel.
  // 2026-06-13 — the briefing is FORWARD-LOOKING: no past items, window =
  // today + the next 3 days (BRIEFING_FORWARD_*). Events are narrowed to
  // today (tomorrow's first item is acceptable TZ-boundary slack);
  // deadlines use the shared 72h forward horizon.
  const [queueCards, events, dueSoon, todayTasks, userRow] =
    await Promise.all([
      buildQueueForUser(userId, locale),
      getTodaysEvents(userId, { daysAhead: 1 }),
      getDueSoonAssignments(userId, BRIEFING_FORWARD_HOURS, tz),
      fetchTodayTasks(userId),
      db
        .select({ undoWindowSeconds: users.undoWindowSeconds })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    ]);
  // Per-user undo window — the server enqueues the send with this delay,
  // and the queue card drives its countdown from the same value so the
  // visible timer matches when the message actually leaves.
  const undoWindowSeconds = userRow[0]?.undoWindowSeconds ?? 10;

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
          requires more attention than a quick scan. Restored 2026-06-13
          (was removed in PR #274). */}
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
            undoWindowSeconds={undoWindowSeconds}
            actions={{
              resolveProposal: queueResolveProposalAction,
              submitClarification: queueSubmitClarificationAction,
              startClarificationChat: startClarificationChatAction,
              dismiss: queueDismissAction,
              snooze: queueSnoozeAction,
              permanentDismiss: queuePermanentDismissAction,
              ignoreSender: ignoreSenderAction,
              secondaryAction: queueSecondaryAction,
              sendDraft: queueSendDraftAction,
              sendDraftAnyway: queueSendDraftAnywayAction,
              cancelSendDraft: queueCancelSendDraftAction,
              sendOfficeHours: queueSendOfficeHoursAction,
              setDisposition: queueSetDispositionAction,
              markHandled: queueMarkHandledAction,
              markNotNeeded: queueMarkNotNeededAction,
              confirm: queueConfirmAction,
              correct: queueCorrectAction,
              addToCalendar: async (cardId) => {
                "use server";
                await autoCalProposalAddAction(cardId);
              },
              editProposal: async (cardId, updates) => {
                "use server";
                await autoCalProposalEditAction(cardId, updates);
              },
              dismissProposal: autoCalProposalDismissAction,
              archiveProposalConfirm: async (inboxItemIds) => {
                "use server";
                await archiveProposalConfirmAllAction(
                  inboxItemIds ? { inboxItemIds } : undefined,
                );
              },
              archiveProposalDismiss: async () => {
                "use server";
                await archiveProposalDismissAllAction();
              },
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

// Source-aware task shape consumed by the in-app home briefing, the digest
// email pipeline, and the /app/tasks one-click checkbox. The `kind`
// discriminator routes a complete back to the right provider (Steadii DB /
// Google Tasks / Microsoft To Do). Pulls from three sources for /app/tasks
// parity:
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
async function fetchTodayTasks(userId: string): Promise<TodayTask[]> {
  const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
  const today = todayDateInTz(tz);
  // 2026-06-13 — FORWARD-ONLY briefing. Lower bound = LOCAL midnight today,
  // upper bound = today + BRIEFING_FORWARD_DAYS. Nothing past-due appears;
  // the window matches the deadline/digest loaders via the shared constant.
  const start = localMidnightAsUtc(today, tz);
  const end = localMidnightAsUtc(
    addDaysToDateStr(today, BRIEFING_FORWARD_DAYS),
    tz
  );

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
          // 2026-06-13 — symmetric forward-only lower bound. Replaces the
          // old "drop the lower bound / show overdue" behavior: a past-due
          // assignment no longer surfaces in the forward briefing.
          gte(assignmentsTable.dueAt, start),
          lte(assignmentsTable.dueAt, end)
        )
      )
      .orderBy(asc(assignmentsTable.dueAt))
      .limit(25),
    // External fetchers soft-fail when the integration isn't connected;
    // .catch keeps a single broken provider from blanking the briefing.
    // The window is forward-only now (today → today + BRIEFING_FORWARD_DAYS),
    // so we no longer open `daysBack` to pull overdue rows — mergeTodayTasks's
    // [today, weekEnd] band drops anything past-due that slips through.
    fetchUpcomingTasks(userId, { days: BRIEFING_FORWARD_DAYS, max: 50 }).catch(
      () => []
    ),
    fetchMsUpcomingTasks(userId, {
      days: BRIEFING_FORWARD_DAYS,
      max: 50,
    }).catch(() => []),
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
    addDaysToDateStr(today, BRIEFING_FORWARD_DAYS)
  );
}

// Pure helper — extracted so the merge logic can be unit-tested
// without mocking three sources of side-effects.
//
// 2026-06-13 — FORWARD-ONLY briefing. External tasks are filtered to the
// closed band [todayStr, weekEndStr]: a SYMMETRIC lower bound (>= today)
// drops anything past-due, and the upper bound caps the forward horizon.
// Steadii rows with a concrete due date get the same lower-bound guard
// (defense-in-depth — the query already forward-bounds them, but a
// date-only row must never slip a past-due item into the briefing). Rows
// with a null due date (Steadii assignments without a deadline) are kept.
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
  // Default the upper bound to today if none supplied. The lower bound is
  // always today (forward-only) so no caller can re-introduce past-due rows.
  const upper = weekEndStr ?? todayStr;
  const inForwardBand = (due: string): boolean =>
    due >= todayStr && due <= upper;
  const out: TodayTask[] = [
    ...steadii
      // null due = no deadline, always keep; concrete due must be forward.
      .filter((r) => r.due === null || inForwardBand(r.due))
      .map(
        (r): TodayTask => ({
          kind: "steadii",
          id: r.id,
          title: r.title,
          classTitle: r.classTitle,
          due: r.due,
        })
      ),
    ...google
      .filter((t) => inForwardBand(t.due))
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
      .filter((t) => inForwardBand(t.due))
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
