"use client";

import {
  startOfDay,
  type CalendarEvent,
  type CalendarTask,
  type PendingCreate,
} from "@/lib/calendar/events";
import { TimeGrid } from "./time-grid";

type Props = {
  anchor: Date;
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

export function DayView({
  anchor,
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
  const days = [startOfDay(anchor)];
  return (
    <TimeGrid
      days={days}
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
  );
}
