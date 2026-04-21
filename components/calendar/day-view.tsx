"use client";

import { startOfDay, type CalendarEvent } from "@/lib/calendar/events";
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

export function DayView({
  anchor,
  events,
  onEventClick,
  onDragMove,
  onCreateAt,
}: Props) {
  const days = [startOfDay(anchor)];
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
