"use client";

import { useEffect, useRef, useState } from "react";
import {
  WEEKDAYS_SHORT,
  addDays,
  eventsOnDay,
  formatDateInput,
  formatHour12,
  formatTime12,
  layoutDayColumns,
  minutesSinceMidnight,
  parseEventEnd,
  parseEventStart,
  rfc3339Local,
  sameDay,
  snapToSlot,
  type CalendarEvent,
  type CalendarTask,
  type PendingCreate,
} from "@/lib/calendar/events";

export const SLOT_MIN = 30;
export const SLOT_PX = 24;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MIN;
export const GRID_HEIGHT = SLOTS_PER_DAY * SLOT_PX;
export const GUTTER_PX = 56;
const DRAG_MIME = "application/x-steadii-event";

type Props = {
  days: Date[];
  events: CalendarEvent[];
  tasks: CalendarTask[];
  pendingCreate: PendingCreate;
  onEventClick: (e: CalendarEvent) => void;
  onTaskClick: (t: CalendarTask) => void;
  onToggleTaskComplete: (t: CalendarTask) => void;
  onDragMove: (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => void;
  onCreateAt: (prefill: {
    start: string;
    end: string;
    allDay: boolean;
  }) => void;
  onPendingCreate: (args: {
    dayIso: string;
    startSlot: number;
    endSlot: number;
    prefill: { start: string; end: string; allDay: boolean };
  }) => void;
};

export function TimeGrid({
  days,
  events,
  tasks,
  pendingCreate,
  onEventClick,
  onTaskClick,
  onToggleTaskComplete,
  onDragMove,
  onCreateAt,
  onPendingCreate,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (scrolled.current || !scrollerRef.current) return;
    scrollerRef.current.scrollTop = SLOT_PX * 2 * 7; // start at 7am
    scrolled.current = true;
  }, []);

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-[hsl(var(--border))]">
        <div className="shrink-0" style={{ width: GUTTER_PX }} />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => {
            const isToday = sameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className="flex flex-col items-center gap-0.5 px-2 py-2"
              >
                <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {WEEKDAYS_SHORT[d.getDay()]}
                </div>
                <div
                  className={
                    "flex h-6 w-6 items-center justify-center rounded-full text-small tabular-nums " +
                    (isToday
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold"
                      : "text-[hsl(var(--foreground))]")
                  }
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AllDayStrip
        days={days}
        events={allDayEvents}
        tasks={tasks}
        onEventClick={onEventClick}
        onTaskClick={onTaskClick}
        onToggleTaskComplete={onToggleTaskComplete}
        onCreateAt={onCreateAt}
      />

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: GRID_HEIGHT }}>
          <HourGutter />
          <div
            className="relative grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((d, idx) => (
              <DayColumn
                key={d.toISOString()}
                day={d}
                dayEvents={eventsOnDay(timedEvents, d)}
                allTimedEvents={timedEvents}
                hasLeftBorder={idx > 0}
                pendingCreate={pendingCreate}
                onEventClick={onEventClick}
                onDragMove={onDragMove}
                onPendingCreate={onPendingCreate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HourGutter() {
  const hours = Array.from({ length: 24 }, (_, h) => formatHour12(h));
  return (
    <div
      className="relative shrink-0 border-r border-[hsl(var(--border))]"
      style={{ width: GUTTER_PX }}
    >
      {hours.map((label, h) => (
        <div
          key={h}
          className="absolute right-2 text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
          style={{ top: h * SLOT_PX * 2 - 6 }}
        >
          {h === 0 ? "" : label}
        </div>
      ))}
    </div>
  );
}

function DayColumn({
  day,
  dayEvents,
  allTimedEvents,
  hasLeftBorder,
  pendingCreate,
  onEventClick,
  onDragMove,
  onPendingCreate,
}: {
  day: Date;
  dayEvents: CalendarEvent[];
  allTimedEvents: CalendarEvent[];
  hasLeftBorder: boolean;
  pendingCreate: PendingCreate;
  onEventClick: (e: CalendarEvent) => void;
  onDragMove: (args: {
    eventId: string;
    newStart: string;
    newEnd: string;
  }) => void;
  onPendingCreate: (args: {
    dayIso: string;
    startSlot: number;
    endSlot: number;
    prefill: { start: string; end: string; allDay: boolean };
  }) => void;
}) {
  const bgRef = useRef<HTMLDivElement>(null);
  const [dragSel, setDragSel] = useState<{
    startSlot: number;
    endSlot: number;
  } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<number | null>(null);
  const slots = layoutDayColumns(dayEvents);
  const isToday = sameDay(day, new Date());

  const getSlotFromY = (clientY: number): number => {
    const rect = bgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const y = clientY - rect.top;
    return Math.max(0, Math.min(SLOTS_PER_DAY - 1, Math.floor(y / SLOT_PX)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = getSlotFromY(e.clientY);
    setDragSel({ startSlot: s, endSlot: s + 1 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragSel) return;
    const s = getSlotFromY(e.clientY);
    setDragSel((prev) =>
      prev ? { ...prev, endSlot: Math.max(prev.startSlot + 1, s + 1) } : prev,
    );
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragSel) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const { startSlot, endSlot } = dragSel;
    setDragSel(null);
    const startDate = new Date(day);
    startDate.setHours(0, Math.floor(startSlot * SLOT_MIN), 0, 0);
    const endDate = new Date(day);
    endDate.setHours(0, Math.floor(endSlot * SLOT_MIN), 0, 0);
    onPendingCreate({
      dayIso: day.toISOString(),
      startSlot,
      endSlot,
      prefill: {
        start: toLocalNaive(startDate),
        end: toLocalNaive(endDate),
        allDay: false,
      },
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    const s = getSlotFromY(e.clientY);
    setDropIndicator(s);
  };
  const onDragLeave = () => setDropIndicator(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropIndicator(null);
    const eventId = e.dataTransfer.getData(DRAG_MIME);
    if (!eventId) return;
    const ev = allTimedEvents.find((x) => x.id === eventId);
    if (!ev) return;
    const slot = getSlotFromY(e.clientY);
    const startDate = new Date(day);
    const snapMin = snapToSlot(slot * SLOT_MIN);
    startDate.setHours(0, snapMin, 0, 0);
    const origStart = parseEventStart(ev);
    const origEnd = parseEventEnd(ev);
    const durMs = origEnd.getTime() - origStart.getTime();
    const endDate = new Date(startDate.getTime() + durMs);
    onDragMove({
      eventId,
      newStart: rfc3339Local(startDate),
      newEnd: rfc3339Local(endDate),
    });
  };

  return (
    <div
      className={
        "relative " +
        (hasLeftBorder ? "border-l border-[hsl(var(--border))] " : "") +
        (isToday ? "bg-[hsl(var(--primary)/0.03)]" : "")
      }
    >
      <div
        ref={bgRef}
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            className="absolute left-0 right-0 border-t border-[hsl(var(--border))]"
            style={{ top: h * SLOT_PX * 2 }}
          />
        ))}
      </div>

      {(() => {
        const rect =
          dragSel ??
          (pendingCreate && pendingCreate.dayIso === day.toISOString()
            ? {
                startSlot: pendingCreate.startSlot,
                endSlot: pendingCreate.endSlot,
              }
            : null);
        if (!rect) return null;
        return (
          // v2: drag/resize the pending placeholder to adjust times
          <div
            style={{
              position: "absolute",
              top: rect.startSlot * SLOT_PX + 1,
              height: (rect.endSlot - rect.startSlot) * SLOT_PX - 2,
              left: 2,
              right: 2,
              backgroundColor: "hsl(38 92% 50% / 0.55)",
              border: "2px solid hsl(38 92% 50%)",
              borderRadius: 6,
              boxShadow: "0 4px 12px hsl(38 92% 50% / 0.3)",
              zIndex: 50,
              pointerEvents: "none",
            }}
          />
        );
      })()}

      {dropIndicator !== null && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-[5] h-1 bg-[hsl(var(--primary))] shadow-md"
          style={{ top: dropIndicator * SLOT_PX }}
        />
      )}

      {isToday && <CurrentTimeLine />}

      {slots.map((slot) => {
        const ev = dayEvents.find((e) => e.id === slot.eventId);
        if (!ev) return null;
        return (
          <TimedEventBlock
            key={ev.id}
            event={ev}
            day={day}
            col={slot.col}
            cols={slot.cols}
            onClick={() => onEventClick(ev)}
          />
        );
      })}
    </div>
  );
}

function TimedEventBlock({
  event,
  day,
  col,
  cols,
  onClick,
}: {
  event: CalendarEvent;
  day: Date;
  col: number;
  cols: number;
  onClick: () => void;
}) {
  const s = parseEventStart(event);
  const e = parseEventEnd(event);
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(24, 0, 0, 0);
  const clampedStart = s < dayStart ? dayStart : s;
  const clampedEnd = e > dayEnd ? dayEnd : e;
  const startMin = minutesSinceMidnight(clampedStart);
  const endMin =
    clampedEnd.getTime() === dayEnd.getTime()
      ? 24 * 60
      : minutesSinceMidnight(clampedEnd);
  const top = (startMin / SLOT_MIN) * SLOT_PX;
  const height = Math.max(SLOT_PX - 2, ((endMin - startMin) / SLOT_MIN) * SLOT_PX);
  const widthPct = 100 / cols;
  const leftPct = col * widthPct;
  const timeLabel = formatTime12(s);
  const isOptimistic = event.id.startsWith("optimistic-");

  return (
    <div
      draggable={!isOptimistic}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, event.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => {
        // prevent column pointer-capture from starting drag-create on us
        e.stopPropagation();
      }}
      style={{
        top: top + 1,
        height: height - 2,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
      className="absolute z-10 cursor-pointer overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-1.5 py-1 text-[11px] shadow-sm transition-hover hover:shadow"
    >
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
        <span className="truncate font-medium text-[hsl(var(--foreground))]">
          {event.summary}
        </span>
      </div>
      {height > SLOT_PX && (
        <div className="truncate text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {timeLabel}
        </div>
      )}
    </div>
  );
}

function CurrentTimeLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const top = (minutesSinceMidnight(now) / SLOT_MIN) * SLOT_PX;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top }}
    >
      <div className="relative h-0.5 bg-[hsl(var(--primary))]">
        <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))]" />
      </div>
    </div>
  );
}

function AllDayStrip({
  days,
  events,
  tasks,
  onEventClick,
  onTaskClick,
  onToggleTaskComplete,
  onCreateAt,
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: CalendarTask[];
  onEventClick: (e: CalendarEvent) => void;
  onTaskClick: (t: CalendarTask) => void;
  onToggleTaskComplete: (t: CalendarTask) => void;
  onCreateAt: (prefill: {
    start: string;
    end: string;
    allDay: boolean;
  }) => void;
}) {
  if (days.length === 0) return null;
  return (
    <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <div
        className="shrink-0 border-r border-[hsl(var(--border))] py-1 pr-2 text-right text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
        style={{ width: GUTTER_PX }}
      >
        all-day
      </div>
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d, idx) => {
          const dayKey = formatDateInput(d);
          const dayEvents = events.filter((e) => {
            const s = parseEventStart(e);
            const end = parseEventEnd(e);
            return s <= d && d < end;
          });
          const dayTasks = tasks.filter((t) => t.due === dayKey);
          return (
            <div
              key={d.toISOString()}
              onClick={() =>
                onCreateAt({
                  start: formatDateInput(d),
                  end: formatDateInput(addDays(d, 1)),
                  allDay: true,
                })
              }
              className={
                "min-h-[28px] space-y-0.5 p-1 " +
                (idx > 0 ? "border-l border-[hsl(var(--border))] " : "")
              }
            >
              {dayEvents.map((ev) => (
                <div
                  key={ev.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(ev);
                  }}
                  className="cursor-pointer truncate rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[11px] text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]/80"
                >
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))] align-middle" />
                  {ev.summary}
                </div>
              ))}
              {dayTasks.map((t) => (
                <TaskPill
                  key={t.id}
                  task={t}
                  onOpen={() => onTaskClick(t)}
                  onToggle={() => onToggleTaskComplete(t)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskPill({
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
      className="flex cursor-pointer items-center gap-1.5 truncate rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[11px] text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]/80"
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
            : "")
        }
      >
        {task.title}
      </span>
    </div>
  );
}

function toLocalNaive(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
