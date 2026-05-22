import "server-only";

// 2026-05-21 — Phase 4 of α-auto-cal. The grace-window cron:
//   1. Finds all auto_created_calendar_events rows where
//      status='provisional' AND grace_expires_at <= now()
//   2. For each calendar event in event_refs:
//        - GET the event to read its current title
//        - If the title starts with "[Steadii] ", drop the prefix
//          and PATCH the event back
//   3. Flips the row's status to 'confirmed'
//
// Pure module — the HTTP cron route in
// app/api/cron/auto-cal-grace/route.ts is a thin wrapper around
// `runAutoCalGraceSweep` so the same logic is unit-testable + can
// be invoked from a manual admin trigger if needed.
//
// Resilience: per-row failures (event deleted in Google, OAuth
// revoked, network blip) are logged + skipped, NOT fatal. A bad row
// doesn't stop the rest of the sweep.

import { and, eq, lte } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db/client";
import {
  autoCreatedCalendarEvents,
  type AutoCreatedCalendarEventRow,
  type AutoCreatedEventRef,
} from "@/lib/db/schema";

export const STEADII_PREFIX = "[Steadii] ";

export type AutoCalGraceSweepResult = {
  scanned: number;
  promoted: number;
  renameFailures: number;
  skipped: number;
};

// Injectable so unit tests can stub GET + PATCH without spinning up
// Google Calendar.
export type CalendarTitleEditor = {
  // Returns the current event title, or null if the event isn't
  // findable (deleted, permissions revoked, etc.).
  fetchTitle: (args: {
    userId: string;
    ref: AutoCreatedEventRef;
  }) => Promise<string | null>;
  // Patches the event with a new title.
  updateTitle: (args: {
    userId: string;
    ref: AutoCreatedEventRef;
    newTitle: string;
  }) => Promise<void>;
};

export async function runAutoCalGraceSweep(args: {
  // ms epoch for "now" — pass Date.now() in production, fixed value
  // in tests for determinism.
  nowMs: number;
  // Cap on rows processed in one sweep so a backlog doesn't time out
  // the cron. Default 100; can be tuned via env later.
  limit?: number;
  // Injectable calendar editor. Production callers pass the default
  // Google-Calendar-backed editor.
  editor: CalendarTitleEditor;
}): Promise<AutoCalGraceSweepResult> {
  const { nowMs, editor, limit = 100 } = args;
  const now = new Date(nowMs);

  const rows = await db
    .select()
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.status, "provisional"),
        lte(autoCreatedCalendarEvents.graceExpiresAt, now),
      ),
    )
    .limit(limit);

  let promoted = 0;
  let renameFailures = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const remainingFailures = await promoteRow({ row, editor });
      if (remainingFailures > 0) renameFailures += remainingFailures;
      promoted++;
    } catch (err) {
      skipped++;
      Sentry.captureException(err, {
        tags: { feature: "auto_cal", phase: "grace_sweep" },
        user: { id: row.userId },
        extra: { autoCreateId: row.id },
      });
    }
  }

  return {
    scanned: rows.length,
    promoted,
    renameFailures,
    skipped,
  };
}

async function promoteRow(args: {
  row: AutoCreatedCalendarEventRow;
  editor: CalendarTitleEditor;
}): Promise<number> {
  const { row, editor } = args;
  let renameFailures = 0;

  for (const ref of row.eventRefs) {
    try {
      const currentTitle = await editor.fetchTitle({
        userId: row.userId,
        ref,
      });
      if (currentTitle === null) {
        // Event deleted upstream — nothing to rename. Don't count as a
        // failure; the row promotion still proceeds.
        continue;
      }
      if (!currentTitle.startsWith(STEADII_PREFIX)) {
        // Already renamed (user edited the event, or an earlier sweep
        // partial-succeeded). Skip without error.
        continue;
      }
      const newTitle = currentTitle.slice(STEADII_PREFIX.length);
      await editor.updateTitle({
        userId: row.userId,
        ref,
        newTitle,
      });
    } catch (err) {
      renameFailures++;
      Sentry.captureException(err, {
        tags: { feature: "auto_cal", phase: "grace_rename" },
        user: { id: row.userId },
        extra: { autoCreateId: row.id, eventId: ref.eventId },
      });
    }
  }

  // Flip status to 'confirmed' regardless of per-event rename outcomes.
  // The user's intent ("don't cancel within 24h") is the signal we
  // care about; the title prefix is cosmetic and can be hand-fixed
  // if a rename failed permanently.
  await db
    .update(autoCreatedCalendarEvents)
    .set({ status: "confirmed" })
    .where(eq(autoCreatedCalendarEvents.id, row.id));

  return renameFailures;
}

// ---------- production calendar editor ----------

export async function defaultCalendarTitleEditor(): Promise<CalendarTitleEditor> {
  // Lazy-imported inside the factory so unit tests that supply their
  // own mocked editor never reach Google client init.
  const { getCalendarForUser } = await import(
    "@/lib/integrations/google/calendar"
  );

  return {
    async fetchTitle({ userId, ref }) {
      if (ref.provider !== "google_calendar") return null;
      try {
        const cal = await getCalendarForUser(userId);
        const resp = await cal.events.get({
          calendarId: "primary",
          eventId: ref.eventId,
        });
        return resp.data.summary ?? null;
      } catch (err) {
        // 404 (event deleted) or 410 (calendar revoked) → null.
        // Re-throw other errors so the caller's Sentry path catches.
        const status = (err as { status?: number; code?: number })
          .status ?? (err as { code?: number }).code;
        if (status === 404 || status === 410) return null;
        throw err;
      }
    },
    async updateTitle({ userId, ref, newTitle }) {
      if (ref.provider !== "google_calendar") return;
      const cal = await getCalendarForUser(userId);
      await cal.events.patch({
        calendarId: "primary",
        eventId: ref.eventId,
        requestBody: { summary: newTitle },
      });
    },
  };
}
