"use client";

import { addDays, startOfWeek, type CalendarEvent } from "@/lib/calendar/events";
import { TimeGrid } from "./time-grid";

type Props = {
  anchor: Date;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
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
};

export function WeekView({
  anchor,
  events,
  onEventClick,
  onDragMove,
  onCreateAt,
}: Props) {
  const weekStart = startOfWeek(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) days.push(addDays(weekStart, i));
  return (
    <TimeGrid
      days={days}
      events={events}
      onEventClick={onEventClick}
      onDragMove={onDragMove}
      onCreateAt={onCreateAt}
    />
  );
}
