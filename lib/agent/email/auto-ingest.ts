import "server-only";
import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { ingestLast24h } from "./ingest-recent";
import { maybeTriggerEmailBackfill } from "./backfill";

// 24h cool-off between automatic ingests. Prevents repeated page loads
// from spamming Gmail with redundant fetches. Manual refresh via Settings
// still works independently.
const AUTO_INGEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Fire-and-forget caller used by app/app/layout.tsx. Schedules an
// ingestLast24h on first Gmail-scope detection (or after the 24h
// cooldown) and records `users.last_gmail_ingest_at` so subsequent
// renders don't duplicate.
//
// Never blocks the render — swallows all errors (Sentry captures them).
// Because this is called from a server component, we rely on Next's
// runtime to keep the Promise alive past response flush.
export async function maybeTriggerAutoIngest(args: {
  userId: string;
  gmailConnected: boolean;
}): Promise<void> {
  if (!args.gmailConnected) return;

  // One-time 30-day backfill enqueue. Self-gated by the
  // email_backfill_completed_at marker (fires at most once per user), so
  // it's safe to invoke on every render and independent of the 24h ingest
  // cooldown below — a returning user who already ingested but predates
  // this feature still gets their pre-signup corpus filled in. Publishes a
  // QStash one-shot; never runs inline.
  void maybeTriggerEmailBackfill({
    userId: args.userId,
    gmailConnected: args.gmailConnected,
  }).catch((err) => {
    Sentry.captureException(err, {
      tags: { feature: "email_backfill", op: "schedule_from_auto_ingest" },
      user: { id: args.userId },
    });
  });

  try {
    const [row] = await db
      .select({ lastGmailIngestAt: users.lastGmailIngestAt })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);
    const last = row?.lastGmailIngestAt ?? null;
    const now = new Date();
    if (last && now.getTime() - last.getTime() < AUTO_INGEST_COOLDOWN_MS) {
      return;
    }
    // Write the attempt timestamp synchronously BEFORE the async ingest so
    // two concurrent renders don't both fire. Worst-case an ingest fails
    // and we skip for 24h — acceptable since manual refresh still works.
    await db
      .update(users)
      .set({ lastGmailIngestAt: now, updatedAt: now })
      .where(eq(users.id, args.userId));

    // Fire-and-forget — cast the promise so Next doesn't await it.
    void ingestLast24h(args.userId).catch((err) => {
      Sentry.captureException(err, {
        tags: { feature: "email_auto_ingest" },
        user: { id: args.userId },
      });
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_auto_ingest", op: "schedule" },
      user: { id: args.userId },
    });
  }
}
