"use client";

import { useState } from "react";
import {
  WEEKDAYS_SHORT,
  addDays,
  formatDateInput,
  formatTime12,
  parseEventStart,
  parseEventEnd,
  rfc3339Local,
  sameDay,
  startOfDay,
  startOfMonthGrid,
  type CalendarEvent,
  type CalendarTask,
} from "@/lib/calendar/events";

type Props = {
  anchor: Date;
  events: CalendarEvent[];
  tasks: CalendarTask[];
  onEventClick: (e: CalendarEvent) => void;
  onTaskClick: (t: CalendarTask) => void;
  onToggleTaskComplete: (t: CalendarTask) => void;
  onDragMove: (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => void;
  onDayClick: (d: Date) => void;
};

const DRAG_MIME = "application/x-steadii-event";

export function MonthView({
  anchor,
  events,
  tasks,
  onEventClick,
  onTaskClick,
  onToggleTaskComplete,
  onDragMove,
  onDayClick,
}: Props) {
  const gridStart = startOfMonthGrid(anchor);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(gridStart, i));
  const today = new Date();
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Month-view only renders events and tasks. Steadii assignments are
  // projected into tasks by `assignmentAsTask` upstream in CalendarView,
  // so the byDay bucket can stay narrowed.
  const byDay = new Map<string, Array<CalendarEvent | CalendarTask>>();
  const gridEnd = addDays(gridStart, 42);
  for (const ev of events) {
    const s = parseEventStart(ev);
    const e = parseEventEnd(ev);
    for (let d = startOfDay(s); d < e; d = addDays(d, 1)) {
      if (d < gridStart) continue;
      if (d >= gridEnd) break;
      const key = formatDateInput(d);
      const list = byDay.get(key) ?? [];
      list.push(ev);
      byDay.set(key, list);
    }
  }
  for (const t of tasks) {
    const key = t.due;
    const list = byDay.get(key) ?? [];
    list.push(t);
    byDay.set(key, list);
  }

  const handleDrop = (day: Date, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const eventId = e.dataTransfer.getData(DRAG_MIME);
    if (!eventId) return;
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const origStart = parseEventStart(ev);
    const origEnd = parseEventEnd(ev);
    const durMs = origEnd.getTime() - origStart.getTime();
    if (ev.allDay) {
      const newStart = formatDateInput(day);
      const newEnd = formatDateInput(new Date(day.getTime() + durMs));
      onDragMove({ eventId, newStart, newEnd });
    } else {
      const newStart = new Date(day);
      newStart.setHours(
        origStart.getHours(),
        origStart.getMinutes(),
        0,
        0,
      );
      const newEnd = new Date(newStart.getTime() + durMs);
      onDragMove({
        eventId,
        newStart: rfc3339Local(newStart),
        newEnd: rfc3339Local(newEnd),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b border-[hsl(var(--border))]">
        {WEEKDAYS_SHORT.map((label) => (
          <div
            key={label}
            className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {cells.map((d) => {
          const key = formatDateInput(d);
          const dayItems = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const visible = dayItems.slice(0, 3);
          const overflow = dayItems.length - visible.length;
          return (
            <div
              key={key}
              onClick={(e) => {
                if (e.target === e.currentTarget) onDayClick(d);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  setDragOver(key);
                }
              }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e) => handleDrop(d, e)}
              className={
                "relative border-b border-r border-[hsl(var(--border))] p-1.5 text-xs " +
                (inMonth
                  ? "bg-[hsl(var(--surface))]"
                  : "bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]") +
                (dragOver === key ? " outline outline-2 -outline-offset-2 outline-[hsl(var(--primary))]" : "")
              }
            >
              <div
                className={
                  "mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums " +
                  (isToday
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium"
                    : "text-[hsl(var(--foreground))]")
                }
              >
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) =>
                  item.kind === "event" ? (
                    <MonthEventPill
                      key={`e-${item.id}`}
                      event={item}
                      onClick={() => onEventClick(item)}
                    />
                  ) : (
                    <MonthTaskPill
                      key={`t-${item.id}`}
                      task={item}
                      onOpen={() => onTaskClick(item)}
                      onToggle={() => onToggleTaskComplete(item)}
                    />
                  ),
                )}
                {overflow > 0 && (
                  <div className="pl-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthEventPill({
  event,
  onClick,
}: {
  event: CalendarEvent;
  onClick: () => void;
}) {
  const time = event.allDay ? null : formatTime12(parseEventStart(event));
  return (
    <div
      draggable
      onDragStart={(e) => {
        if (event.id.startsWith("optimistic-")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(DRAG_MIME, event.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
      {time && (
        <span className="shrink-0 tabular-nums text-[hsl(var(--muted-foreground))]">
          {time}
        </span>
      )}
      <span className="truncate text-[hsl(var(--foreground))]">
        {event.summary}
      </span>
    </div>
  );
}

function MonthTaskPill({
  task,
  onOpen,
  onToggle,
}: {
  task: CalendarTask;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="flex cursor-pointer items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={task.completed}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors " +
          (task.completed
            ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "border-[hsl(var(--muted-foreground))] bg-transparent hover:border-[hsl(var(--foreground))]")
        }
      >
        {task.completed && (
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="2.5,6.5 5,9 9.5,3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span
        className={
          "truncate " +
          (task.completed
            ? "text-[hsl(var(--muted-foreground))] line-through"
            : "text-[hsl(var(--foreground))]")
        }
      >
        {task.title}
      </span>
    </div>
  );
}
