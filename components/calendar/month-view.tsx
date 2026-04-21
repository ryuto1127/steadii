"use client";

import { useState } from "react";
import {
  addDays,
  formatDateInput,
  parseEventStart,
  parseEventEnd,
  rfc3339Local,
  sameDay,
  startOfDay,
  startOfMonthGrid,
  type CalendarEvent,
} from "@/lib/calendar/events";

type Props = {
  anchor: Date;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
  onDragMove: (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => void;
  onDayClick: (d: Date) => void;
};

const DRAG_MIME = "application/x-steadii-event";
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({
  anchor,
  events,
  onEventClick,
  onDragMove,
  onDayClick,
}: Props) {
  const gridStart = startOfMonthGrid(anchor);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(gridStart, i));
  const today = new Date();
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byDay = new Map<string, CalendarEvent[]>();
  const gridEnd = addDays(gridStart, 42);
  for (const ev of events) {
    const s = parseEventStart(ev);
    const e = parseEventEnd(ev);
    // Iterate by whole day starting at s's local-day; continue while day < e.
    for (let d = startOfDay(s); d < e; d = addDays(d, 1)) {
      if (d < gridStart) continue;
      if (d >= gridEnd) break;
      const key = formatDateInput(d);
      const list = byDay.get(key) ?? [];
      list.push(ev);
      byDay.set(key, list);
    }
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
        {WEEKDAY_LABELS.map((label) => (
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
          const dayEvents = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
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
                {visible.map((ev) => (
                  <MonthEventPill
                    key={ev.id}
                    event={ev}
                    onClick={() => onEventClick(ev)}
                  />
                ))}
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
  const time = event.allDay
    ? null
    : parseEventStart(event).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
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
