"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { EventPanel, type PanelState } from "./event-panel";
import {
  addDays,
  addMonths,
  formatDateInput,
  type CalendarEvent,
  type CalendarView as ViewType,
} from "@/lib/calendar/events";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
  type CalendarEventInput,
  type CalendarEventPatch,
} from "@/lib/agent/calendar-actions";

type Props = {
  initialEvents: CalendarEvent[];
  initialView: ViewType;
  initialAnchorIso: string;
  initialError: string | null;
};

export function CalendarView({
  initialEvents,
  initialView,
  initialAnchorIso,
  initialError,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewType>(initialView);
  const [anchor, setAnchor] = useState<Date>(() => new Date(initialAnchorIso));
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [panel, setPanel] = useState<PanelState>({ state: "closed" });
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(initialError);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

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

  const onCreate = async (input: CalendarEventInput) => {
    const tempId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: CalendarEvent = {
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
    setEvents((prev) => [...prev, optimistic]);
    setPanel({ state: "closed" });
    try {
      await createCalendarEventAction(input);
      startTransition(() => router.refresh());
    } catch (e) {
      setEvents((prev) => prev.filter((ev) => ev.id !== tempId));
      setErr(e instanceof Error ? e.message : "Failed to create event");
    }
  };

  const onUpdate = async (patch: CalendarEventPatch) => {
    const prior = events.find((e) => e.id === patch.eventId);
    setEvents((prev) =>
      prev.map((e) =>
        e.id === patch.eventId
          ? {
              ...e,
              summary: patch.summary ?? e.summary,
              start: patch.start ?? e.start,
              end: patch.end ?? e.end,
              allDay: patch.start
                ? /^\d{4}-\d{2}-\d{2}$/.test(patch.start)
                : e.allDay,
              location: patch.location ?? e.location,
              description: patch.description ?? e.description,
              recurrence: patch.recurrence ?? e.recurrence,
              reminders:
                patch.reminders === undefined ? e.reminders : patch.reminders,
            }
          : e,
      ),
    );
    setPanel({ state: "closed" });
    try {
      await updateCalendarEventAction(patch);
      startTransition(() => router.refresh());
    } catch (e) {
      if (prior) {
        setEvents((prev) =>
          prev.map((ev) => (ev.id === prior.id ? prior : ev)),
        );
      }
      setErr(e instanceof Error ? e.message : "Failed to update event");
    }
  };

  const onDelete = async (eventId: string) => {
    const prior = events.find((e) => e.id === eventId);
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setPanel({ state: "closed" });
    try {
      await deleteCalendarEventAction(eventId);
      startTransition(() => router.refresh());
    } catch (e) {
      if (prior) setEvents((prev) => [...prev, prior]);
      setErr(e instanceof Error ? e.message : "Failed to delete event");
    }
  };

  // Drag-to-move: patch start/end only.
  const onDragMove = async (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => {
    void onUpdate({
      eventId: args.eventId,
      start: args.newStart,
      end: args.newEnd,
    });
  };

  const onEventClick = (event: CalendarEvent) =>
    setPanel({ state: "edit", event });

  const onCreateAt = (prefill: {
    start: string;
    end: string;
    allDay: boolean;
  }) => setPanel({ state: "create", prefill });

  const openNewEmpty = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    const start = now;
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    setPanel({
      state: "create",
      prefill: {
        start: toLocalNaive(start),
        end: toLocalNaive(end),
        allDay: false,
      },
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-h1 text-[hsl(var(--foreground))]">Calendar</h1>
          <span className="ml-2 text-small text-[hsl(var(--muted-foreground))] tabular-nums">
            {heading}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
          <div className="flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            <button
              onClick={goPrev}
              aria-label="Previous"
              className="h-7 px-2.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            >
              ←
            </button>
            <span className="h-4 w-px bg-[hsl(var(--border))]" />
            <button
              onClick={goNext}
              aria-label="Next"
              className="h-7 px-2.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            >
              →
            </button>
          </div>
          <ViewToggle view={view} onChange={setView} />
          <Button size="sm" onClick={openNewEmpty}>
            New event
          </Button>
        </div>
      </header>

      {err && (
        <div className="mb-3 rounded-lg bg-[hsl(var(--destructive)/0.1)] px-4 py-2 text-small text-[hsl(var(--destructive))]">
          {err}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {view === "month" && (
            <MonthView
              anchor={anchor}
              events={events}
              onEventClick={onEventClick}
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
              onEventClick={onEventClick}
              onDragMove={onDragMove}
              onCreateAt={onCreateAt}
            />
          )}
          {view === "day" && (
            <DayView
              anchor={anchor}
              events={events}
              onEventClick={onEventClick}
              onDragMove={onDragMove}
              onCreateAt={onCreateAt}
            />
          )}
        </div>

        {panel.state !== "closed" && (
          <EventPanel
            state={panel}
            onClose={() => setPanel({ state: "closed" })}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewType;
  onChange: (v: ViewType) => void;
}) {
  const options: ViewType[] = ["month", "week", "day"];
  return (
    <div className="flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={
            "h-6 rounded px-2 text-small capitalize transition-hover " +
            (view === opt
              ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")
          }
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function formatHeading(view: ViewType, anchor: Date): string {
  if (view === "month") {
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  // week
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}

function toLocalNaive(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
