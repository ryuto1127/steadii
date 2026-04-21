import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { calendarListEvents } from "@/lib/agent/tools/calendar";
import { tasksListEvents } from "@/lib/agent/tools/tasks";
import { TasksNotConnectedError } from "@/lib/integrations/google/tasks";
import {
  isAllDayString,
  visibleRange,
  rfc3339Local,
  type CalendarEvent,
  type CalendarItem,
  type CalendarTask,
  type CalendarView,
  formatDateInput,
} from "@/lib/calendar/events";
import { CalendarView as CalendarViewClient } from "@/components/calendar/calendar-view";

export const dynamic = "force-dynamic";

function parseView(v: string | undefined): CalendarView {
  if (v === "month" || v === "week" || v === "day") return v;
  return "week";
}

function parseAnchor(v: string | undefined): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; anchor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseAnchor(sp.anchor);
  const range = visibleRange(view, anchor);

  const events: CalendarEvent[] = [];
  const tasks: CalendarTask[] = [];
  let err: string | null = null;
  let tasksScopeMissing = false;

  try {
    const res = await calendarListEvents.execute(
      { userId },
      {
        timeMin: rfc3339Local(range.start),
        timeMax: rfc3339Local(range.end),
        limit: 500,
      },
    );
    for (const e of res.events) {
      if (!e.id || !e.start || !e.end) continue;
      const allDay = isAllDayString(e.start);
      events.push({
        kind: "event",
        id: e.id,
        summary: e.summary ?? "(untitled)",
        start: e.start,
        end: e.end,
        allDay,
        location: e.location ?? null,
        description: e.description ?? null,
        recurrence: e.recurrence ?? null,
        recurringEventId: e.recurringEventId ?? null,
        reminders: e.reminders ?? null,
      });
    }
  } catch (e) {
    err = e instanceof Error ? e.message : "failed to load";
  }

  try {
    const res = await tasksListEvents.execute(
      { userId },
      {
        dueMin: formatDateInput(range.start),
        dueMax: formatDateInput(range.end),
        limit: 100,
      },
    );
    for (const t of res.tasks) {
      if (!t.due) continue;
      tasks.push({
        kind: "task",
        id: t.id,
        title: t.title,
        due: t.due,
        notes: t.notes,
        completed: t.status === "completed",
        taskListId: t.taskListId,
        parentId: t.parentId,
      });
    }
  } catch (e) {
    if (e instanceof TasksNotConnectedError) {
      tasksScopeMissing = true;
    } else {
      // Don't clobber a calendar error; surface tasks error only if calendar succeeded.
      if (!err) err = e instanceof Error ? e.message : "failed to load tasks";
    }
  }

  const items: CalendarItem[] = [...events, ...tasks];

  return (
    <CalendarViewClient
      initialItems={items}
      initialView={view}
      initialAnchorIso={anchor.toISOString()}
      initialError={err}
      tasksScopeMissing={tasksScopeMissing}
    />
  );
}
