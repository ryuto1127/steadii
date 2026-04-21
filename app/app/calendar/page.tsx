import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { calendarListEvents } from "@/lib/agent/tools/calendar";
import {
  isAllDayString,
  visibleRange,
  rfc3339Local,
  type CalendarEvent,
  type CalendarView,
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

  let events: CalendarEvent[] = [];
  let err: string | null = null;
  try {
    const res = await calendarListEvents.execute(
      { userId },
      {
        timeMin: rfc3339Local(range.start),
        timeMax: rfc3339Local(range.end),
        limit: 500,
      },
    );
    events = res.events
      .filter((e): e is typeof e & { id: string; summary: string; start: string; end: string } =>
        Boolean(e.id && e.start && e.end),
      )
      .map((e) => {
        const allDay = isAllDayString(e.start);
        return {
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
        } satisfies CalendarEvent;
      });
  } catch (e) {
    err = e instanceof Error ? e.message : "failed to load";
  }

  return (
    <CalendarViewClient
      initialEvents={events}
      initialView={view}
      initialAnchorIso={anchor.toISOString()}
      initialError={err}
    />
  );
}
