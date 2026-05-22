// 2026-05-21 — Phase 3 of α-auto-cal. Cancels a provisional auto-
// created calendar event:
//   1. Validates the row belongs to the authenticated user
//   2. Calls calendar_delete_event for each event_ref (typically one
//      Google event; dual-write case → two deletes)
//   3. Flips status to 'cancelled' + sets cancelled_at = now()
//
// Status guard: only 'provisional' rows can be cancelled here.
// 'confirmed' rows have already passed the grace window (Phase 4 cron
// promoted them) — by then the user should treat them as normal
// calendar events and delete via Google Calendar directly.
//
// Errors during calendar delete don't block the status flip — better
// to mark the row cancelled and leave a Sentry breadcrumb than to
// leave the queue card stuck on a row whose delete API errored.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { autoCreatedCalendarEvents } from "@/lib/db/schema";
import { calendarDeleteEvent } from "@/lib/agent/tools/calendar";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const [row] = await db
    .select()
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.id, id),
        eq(autoCreatedCalendarEvents.userId, userId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.status !== "provisional") {
    return NextResponse.json(
      { error: "not_cancellable", status: row.status },
      { status: 409 },
    );
  }

  // Best-effort calendar delete. Sentry-log per-failure but proceed
  // to flip the row status regardless — the user clicked Cancel and
  // we owe them at least the queue-card disappearance.
  const deleteFailures: string[] = [];
  for (const ref of row.eventRefs) {
    try {
      await calendarDeleteEvent.execute(
        { userId },
        { eventId: ref.eventId },
      );
    } catch (err) {
      deleteFailures.push(ref.eventId);
      Sentry.captureException(err, {
        tags: { feature: "auto_cal", phase: "cancel" },
        user: { id: userId },
        extra: { autoCreateId: id, eventId: ref.eventId },
      });
    }
  }

  await db
    .update(autoCreatedCalendarEvents)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
    })
    .where(eq(autoCreatedCalendarEvents.id, id));

  return NextResponse.json({
    status: "cancelled",
    deleteFailures,
  });
}
