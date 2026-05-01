"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { EventPanel, type PanelState } from "./event-panel";
import {
  MONTHS_LONG,
  MONTHS_SHORT,
  WEEKDAYS_LONG,
  addDays,
  addMonths,
  assignmentAsTask,
  formatDateInput,
  type CalendarEvent,
  type CalendarItem,
  type CalendarTask,
  type CalendarView as ViewType,
  type PendingCreate,
} from "@/lib/calendar/events";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
  type CalendarEventInput,
  type CalendarEventPatch,
} from "@/lib/agent/calendar-actions";
import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  updateTaskAction,
  type TaskInput,
  type TaskPatch,
} from "@/lib/agent/tasks-actions";

type Props = {
  initialItems: CalendarItem[];
  initialView: ViewType;
  initialAnchorIso: string;
  initialError: string | null;
  tasksScopeMissing: boolean;
};

export function CalendarView({
  initialItems,
  initialView,
  initialAnchorIso,
  initialError,
  tasksScopeMissing,
}: Props) {
  const router = useRouter();
  const t = useTranslations("calendar");
  const [view, setView] = useState<ViewType>(initialView);
  const [anchor, setAnchor] = useState<Date>(() => new Date(initialAnchorIso));
  const [items, setItems] = useState<CalendarItem[]>(initialItems);
  const [panel, setPanel] = useState<PanelState>({ state: "closed" });
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>(null);
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(initialError);
  // Auto-collapse to day view on small screens. The URL still allows the
  // user to reach week/month explicitly, but the default cold-load on a
  // phone shows day so the time grid is legible. Tracked separately from
  // the view state so user explicit picks (via the segmented control)
  // are never overridden.
  const userPickedView = useRef(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 639px)");
    const apply = (matches: boolean) => {
      if (userPickedView.current) return;
      if (matches) {
        setView("day");
      }
    };
    apply(mql.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (panel.state !== "create") setPendingCreate(null);
  }, [panel.state]);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setErr(initialError);
  }, [initialError]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", view);
    params.set("anchor", formatDateInput(anchor));
    startTransition(() => {
      router.replace(`/app/calendar?${params.toString()}`, { scroll: false });
    });
  }, [view, anchor, router]);

  const events = useMemo(
    () => items.filter((i): i is CalendarEvent => i.kind === "event"),
    [items],
  );
  // Phase 7 W1 — Steadii assignments project into the task render path.
  // Their original CalendarAssignment shape is preserved in `items` so
  // future detail-pane work can key off `kind === "assignment"` and
  // surface class color / status / priority.
  const tasks = useMemo(
    () =>
      items
        .map<CalendarTask | null>((i) => {
          if (i.kind === "task") return i;
          if (i.kind === "assignment") return assignmentAsTask(i);
          return null;
        })
        .filter((t): t is CalendarTask => t !== null),
    [items],
  );

  const heading = useMemo(() => formatHeading(view, anchor), [view, anchor]);

  const goPrev = () => {
    if (view === "month") setAnchor((a) => addMonths(a, -1));
    else if (view === "week") setAnchor((a) => addDays(a, -7));
    else setAnchor((a) => addDays(a, -1));
  };
  const goNext = () => {
    if (view === "month") setAnchor((a) => addMonths(a, 1));
    else if (view === "week") setAnchor((a) => addDays(a, 7));
    else setAnchor((a) => addDays(a, 1));
  };
  const goToday = () => setAnchor(new Date());

  // ---- Event mutations ----
  const onCreateEvent = async (input: CalendarEventInput) => {
    const tempId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: CalendarEvent = {
      kind: "event",
      id: tempId,
      summary: input.summary,
      start: input.start,
      end: input.end,
      allDay: /^\d{4}-\d{2}-\d{2}$/.test(input.start),
      location: input.location ?? null,
      description: input.description ?? null,
      recurrence: input.recurrence ?? null,
      recurringEventId: null,
      reminders: input.reminders ?? null,
    };
    setItems((prev) => [...prev, optimistic]);
    setPanel({ state: "closed" });
    try {
      await createCalendarEventAction(input);
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      setErr(e instanceof Error ? e.message : t("error_create_event"));
    }
  };

  const onUpdateEvent = async (patch: CalendarEventPatch) => {
    const prior = events.find((e) => e.id === patch.eventId);
    setItems((prev) =>
      prev.map((i) => {
        if (i.kind !== "event" || i.id !== patch.eventId) return i;
        return {
          ...i,
          summary: patch.summary ?? i.summary,
          start: patch.start ?? i.start,
          end: patch.end ?? i.end,
          allDay: patch.start
            ? /^\d{4}-\d{2}-\d{2}$/.test(patch.start)
            : i.allDay,
          location: patch.location ?? i.location,
          description: patch.description ?? i.description,
          recurrence: patch.recurrence ?? i.recurrence,
          reminders:
            patch.reminders === undefined ? i.reminders : patch.reminders,
        };
      }),
    );
    setPanel({ state: "closed" });
    try {
      await updateCalendarEventAction(patch);
      startTransition(() => router.refresh());
    } catch (e) {
      if (prior) {
        setItems((prev) =>
          prev.map((i) => (i.kind === "event" && i.id === prior.id ? prior : i)),
        );
      }
      setErr(e instanceof Error ? e.message : t("error_update_event"));
    }
  };

  const onDeleteEvent = async (eventId: string) => {
    const prior = events.find((e) => e.id === eventId);
    setItems((prev) =>
      prev.filter((i) => !(i.kind === "event" && i.id === eventId)),
    );
    setPanel({ state: "closed" });
    try {
      await deleteCalendarEventAction(eventId);
      startTransition(() => router.refresh());
    } catch (e) {
      if (prior) setItems((prev) => [...prev, prior]);
      setErr(e instanceof Error ? e.message : t("error_delete_event"));
    }
  };

  // ---- Task mutations ----
  const onCreateTask = async (input: TaskInput) => {
    const tempId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: CalendarTask = {
      kind: "task",
      id: tempId,
      title: input.title,
      due: input.due ?? formatDateInput(new Date()),
      notes: input.notes ?? null,
      completed: false,
      taskListId: input.taskListId ?? "@default",
      parentId: null,
    };
    setItems((prev) => [...prev, optimistic]);
    setPanel({ state: "closed" });
    try {
      await createTaskAction(input);
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      setErr(e instanceof Error ? e.message : t("error_create_task"));
    }
  };

  const onUpdateTask = async (patch: TaskPatch) => {
    const prior = tasks.find((t) => t.id === patch.taskId);
    setItems((prev) =>
      prev.map((i) => {
        if (i.kind !== "task" || i.id !== patch.taskId) return i;
        return {
          ...i,
          title: patch.title ?? i.title,
          notes: patch.notes === undefined ? i.notes : patch.notes,
          due: patch.due === undefined ? i.due : patch.due ?? i.due,
        };
      }),
    );
    setPanel({ state: "closed" });
    try {
      await updateTaskAction(patch);
      startTransition(() => router.refresh());
    } catch (e) {
      if (prior) {
        setItems((prev) =>
          prev.map((i) => (i.kind === "task" && i.id === prior.id ? prior : i)),
        );
      }
      setErr(e instanceof Error ? e.message : t("error_update_task"));
    }
  };

  const onToggleTaskComplete = async (task: CalendarTask) => {
    if (task.origin === "google_classroom") return; // read-only
    const next = !task.completed;
    setItems((prev) =>
      prev.map((i) =>
        i.kind === "task" && i.id === task.id ? { ...i, completed: next } : i,
      ),
    );
    try {
      await completeTaskAction({
        taskId: task.id,
        taskListId: task.taskListId,
        completed: next,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((prev) =>
        prev.map((i) =>
          i.kind === "task" && i.id === task.id
            ? { ...i, completed: task.completed }
            : i,
        ),
      );
      setErr(e instanceof Error ? e.message : t("error_update_task"));
    }
  };

  const onDeleteTask = async (task: CalendarTask) => {
    const prior = task;
    setItems((prev) =>
      prev.filter((i) => !(i.kind === "task" && i.id === task.id)),
    );
    setPanel({ state: "closed" });
    try {
      await deleteTaskAction({ taskId: task.id, taskListId: task.taskListId });
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((prev) => [...prev, prior]);
      setErr(e instanceof Error ? e.message : t("error_delete_task"));
    }
  };

  // Drag-to-move a timed event only.
  const onDragMove = async (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => {
    void onUpdateEvent({
      eventId: args.eventId,
      start: args.newStart,
      end: args.newEnd,
    });
  };

  const onEventClick = (event: CalendarEvent) =>
    setPanel({ state: "edit", kind: "event", event });

  const onTaskClick = (task: CalendarTask) => {
    if (task.origin === "google_classroom") {
      if (task.url) window.open(task.url, "_blank", "noopener,noreferrer");
      return;
    }
    setPanel({ state: "edit", kind: "task", task });
  };

  const onCreateAt = (prefill: {
    start: string;
    end: string;
    allDay: boolean;
  }) => {
    setPendingCreate(null);
    setPanel({ state: "create", kind: "event", prefill });
  };

  const onPendingCreate = (args: {
    dayIso: string;
    startSlot: number;
    endSlot: number;
    prefill: { start: string; end: string; allDay: boolean };
  }) => {
    setPendingCreate({
      dayIso: args.dayIso,
      startSlot: args.startSlot,
      endSlot: args.endSlot,
    });
    setPanel({ state: "create", kind: "event", prefill: args.prefill });
  };

  const openNewEmpty = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    const start = now;
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    setPanel({
      state: "create",
      kind: "event",
      prefill: {
        start: toLocalNaive(start),
        end: toLocalNaive(end),
        allDay: false,
      },
    });
  };

  const handleReconnectTasks = () => {
    void signIn("google", { callbackUrl: "/app/calendar" }, { prompt: "consent" });
  };

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col md:h-[calc(100vh-4rem)]">
      <header className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>
          <span className="text-small text-[hsl(var(--muted-foreground))] tabular-nums">
            {heading}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={goToday}>
            {t("today")}
          </Button>
          <div className="flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            <button
              onClick={goPrev}
              aria-label={t("prev_aria")}
              className="flex h-9 w-9 items-center justify-center text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            >
              ←
            </button>
            <span className="h-5 w-px bg-[hsl(var(--border))]" />
            <button
              onClick={goNext}
              aria-label={t("next_aria")}
              className="flex h-9 w-9 items-center justify-center text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            >
              →
            </button>
          </div>
          <ViewToggle
            view={view}
            onChange={(v) => {
              userPickedView.current = true;
              setView(v);
            }}
            labels={{ month: t("view_month"), week: t("view_week"), day: t("view_day") }}
          />
          <Button size="sm" onClick={openNewEmpty} className="ml-auto md:ml-0">
            {t("new_event")}
          </Button>
        </div>
      </header>

      {tasksScopeMissing && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-2 text-small text-[hsl(var(--foreground))]">
          <span>{t("reconnect_for_tasks")}</span>
          <Button size="sm" variant="secondary" onClick={handleReconnectTasks}>
            {t("reconnect_button")}
          </Button>
        </div>
      )}

      {err && (
        <div className="mb-3 rounded-lg bg-[hsl(var(--destructive)/0.1)] px-4 py-2 text-small text-[hsl(var(--destructive))]">
          {err}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <div className="min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {view === "month" && (
            <MonthView
              anchor={anchor}
              events={events}
              tasks={tasks}
              onEventClick={onEventClick}
              onTaskClick={onTaskClick}
              onToggleTaskComplete={onToggleTaskComplete}
              onDragMove={onDragMove}
              onDayClick={(d) =>
                onCreateAt({
                  start: formatDateInput(d),
                  end: formatDateInput(addDays(d, 1)),
                  allDay: true,
                })
              }
            />
          )}
          {view === "week" && (
            <WeekView
              anchor={anchor}
              events={events}
              tasks={tasks}
              pendingCreate={pendingCreate}
              onEventClick={onEventClick}
              onTaskClick={onTaskClick}
              onToggleTaskComplete={onToggleTaskComplete}
              onDragMove={onDragMove}
              onCreateAt={onCreateAt}
              onPendingCreate={onPendingCreate}
            />
          )}
          {view === "day" && (
            <DayView
              anchor={anchor}
              events={events}
              tasks={tasks}
              pendingCreate={pendingCreate}
              onEventClick={onEventClick}
              onTaskClick={onTaskClick}
              onToggleTaskComplete={onToggleTaskComplete}
              onDragMove={onDragMove}
              onCreateAt={onCreateAt}
              onPendingCreate={onPendingCreate}
            />
          )}
        </div>

        {panel.state !== "closed" && (
          <EventPanel
            state={panel}
            onClose={() => setPanel({ state: "closed" })}
            onCreateEvent={onCreateEvent}
            onUpdateEvent={onUpdateEvent}
            onDeleteEvent={onDeleteEvent}
            onCreateTask={onCreateTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onToggleTaskComplete={onToggleTaskComplete}
          />
        )}
      </div>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
  labels,
}: {
  view: ViewType;
  onChange: (v: ViewType) => void;
  labels: { month: string; week: string; day: string };
}) {
  const options: ViewType[] = ["month", "week", "day"];
  return (
    <div className="flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={
            "flex h-8 items-center rounded px-3 text-small capitalize transition-hover " +
            (view === opt
              ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")
          }
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function formatHeading(view: ViewType, anchor: Date): string {
  if (view === "month") {
    return `${MONTHS_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  if (view === "day") {
    return `${WEEKDAYS_LONG[anchor.getDay()]}, ${MONTHS_SHORT[anchor.getMonth()]} ${anchor.getDate()}, ${anchor.getFullYear()}`;
  }
  // week
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function toLocalNaive(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
