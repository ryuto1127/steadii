import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { CommandPalette } from "@/components/chat/command-palette";
import { QueueList } from "@/components/agent/queue-list";
import { QueueEmptyState } from "@/components/agent/queue-empty-state";
import { RecentActivity } from "@/components/agent/recent-activity";
import { buildQueueForUser } from "@/lib/agent/queue/build";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import {
  queueCancelAutoCalAction,
  queueConfirmAction,
  queueConfirmAutoCalAction,
  queueCorrectAction,
  queueDismissAction,
  queuePermanentDismissAction,
  queueResolveProposalAction,
  queueSecondaryAction,
  queueSendDraftAction,
  queueSendOfficeHoursAction,
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

  // One round-trip burst — every panel that needs DB reads is parallel.
  const [queueCards, tzPref] = await Promise.all([
    buildQueueForUser(userId, locale),
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

      {/* 2026-05-18 — TodayBriefing (calendar/tasks/deadlines) removed
          from in-app home per maintainer decision. The same data lands
          via the daily/weekly digest cron emails; the in-app home is now
          queue-first (action items) + RecentActivity. The daily/weekly
          briefing data still feeds the email pipeline — only the in-app
          surface is gone. */}
      <div className="mt-2 md:mt-4">
        {queueCards.length > 0 ? (
          <QueueList
            cards={queueCards}
            actions={{
              resolveProposal: queueResolveProposalAction,
              submitClarification: queueSubmitClarificationAction,
              startClarificationChat: startClarificationChatAction,
              dismiss: queueDismissAction,
              snooze: queueSnoozeAction,
              permanentDismiss: queuePermanentDismissAction,
              secondaryAction: queueSecondaryAction,
              sendDraft: queueSendDraftAction,
              sendOfficeHours: queueSendOfficeHoursAction,
              confirm: queueConfirmAction,
              correct: queueCorrectAction,
              cancelAutoCal: queueCancelAutoCalAction,
              confirmAutoCal: queueConfirmAutoCalAction,
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

// Source-aware task shape consumed by the digest email pipeline and the
// /app/tasks one-click checkbox. The `kind` discriminator routes a
// complete back to the right provider (Steadii DB / Google Tasks /
// Microsoft To Do). Pulls from three sources for /app/tasks parity:
//   1. Steadii assignments (DB, canonical academic-deadline store)
//   2. Google Tasks (live)
//   3. Microsoft To Do (live, when connected)
//
// 2026-05-18 — the in-app today briefing was removed but this type
// stays since the digest cron + unit tests still depend on it.
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

// Pure helper kept after the in-app today briefing was removed
// (2026-05-18) because the digest email pipeline + the unit tests at
// tests/home-today-tasks-merge.test.ts still depend on it. Filters
// external tasks to "overdue → next 7 days" so any reusing surface
// (email digest, /app/tasks, dev preview) gets a week-ahead horizon
// plus still-pending past-due items.
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
