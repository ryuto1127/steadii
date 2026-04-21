"use server";

import { auth } from "@/lib/auth/config";
import { revalidatePath } from "next/cache";
import {
  calendarCreateEvent,
  calendarUpdateEvent,
  calendarDeleteEvent,
} from "@/lib/agent/tools/calendar";

export type CalendarEventInput = {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  recurrence?: string[];
  reminders?: { minutes: number } | null;
};

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

export async function createCalendarEventAction(
  input: CalendarEventInput,
): Promise<{ eventId: string }> {
  const userId = await requireUserId();
  const { eventId } = await calendarCreateEvent.execute(
    { userId },
    {
      summary: input.summary,
      start: input.start,
      end: input.end,
      description: input.description,
      location: input.location,
      recurrence: input.recurrence,
      reminders: input.reminders ?? undefined,
    },
  );
  revalidatePath("/app/calendar");
  return { eventId };
}

export type CalendarEventPatch = {
  eventId: string;
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  recurrence?: string[];
  reminders?: { minutes: number } | null;
};

export async function updateCalendarEventAction(
  patch: CalendarEventPatch,
): Promise<{ eventId: string }> {
  const userId = await requireUserId();
  await calendarUpdateEvent.execute(
    { userId },
    {
      eventId: patch.eventId,
      summary: patch.summary,
      start: patch.start,
      end: patch.end,
      description: patch.description,
      location: patch.location,
      recurrence: patch.recurrence,
      reminders: patch.reminders ?? undefined,
    },
  );
  revalidatePath("/app/calendar");
  return { eventId: patch.eventId };
}

export async function deleteCalendarEventAction(
  eventId: string,
): Promise<{ eventId: string }> {
  const userId = await requireUserId();
  await calendarDeleteEvent.execute({ userId }, { eventId });
  revalidatePath("/app/calendar");
  return { eventId };
}
