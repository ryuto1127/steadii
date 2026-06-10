import "server-only";
import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { qstash } from "@/lib/integrations/qstash/client";
import { env } from "@/lib/env";
import { ingestSince, type IngestSummary } from "./ingest-recent";

// ---------------------------------------------------------------------------
// One-time 30-day email backfill — "first 24 hours match the pitch".
//
// On first Gmail connect the recurring sweep only sees the last 24h, so the
// context-depth moat (retrieval corpus + thread context) starts at zero.
// This module pulls the *older* 24h..30d window once per user and runs it
// through L1 triage + embeddings ONLY (the structural backfillMode gate in
// ingestSince / applyTriageResult). No L2, drafts, queue cards,
// notifications, or auto-cal — `email_embed` is the only metered task type a
// backfill may incur.
//
// The job is published as a QStash one-shot (NOT run inline in the page
// request — 30 days of fetch + embed won't fit a request lifecycle) and
// guarded by the `users.email_backfill_completed_at` marker so it fires at
// most once per user.
// ---------------------------------------------------------------------------

// Backfill spans the 24h..30d window. The lower bound is 30 days back; the
// upper bound is 24h back so the window is disjoint from the recurring
// sweep's last-24h slice (which gets full L2 treatment). Disjoint windows
// mean a backfilled L1+embed-only row can never shadow the sweep's
// full-treatment insert of the same Gmail message.
const BACKFILL_WINDOW_DAYS = 30;
const BACKFILL_UPPER_BOUND_HOURS = 24;

// Run the 30-day backfill for one user. Idempotency against already-ingested
// messages is provided by inbox_items' UNIQUE(user_id, source_type,
// external_id) (applyTriageResult's onConflictDoNothing); this function does
// not need its own dedup. The per-user "ran once" guard is the
// email_backfill_completed_at marker enforced at enqueue time
// (maybeTriggerEmailBackfill).
export async function runEmailBackfill(userId: string): Promise<IngestSummary> {
  const nowMs = Date.now();
  const sinceUnix = Math.floor(
    (nowMs - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000
  );
  const beforeUnix = Math.floor(
    (nowMs - BACKFILL_UPPER_BOUND_HOURS * 60 * 60 * 1000) / 1000
  );

  return ingestSince(userId, {
    sinceUnix,
    beforeUnix,
    windowLabel: "backfill_30d",
    backfillMode: true,
  });
}

// Fire-and-forget trigger. Called from the same first-Gmail-connect hook as
// maybeTriggerAutoIngest (lib/agent/email/auto-ingest.ts). Stamps the
// completion marker BEFORE publishing so two concurrent first-connect
// renders can't double-enqueue; worst case the publish fails and the user
// gets a thinner pre-signup corpus (acceptable — the moat degrades
// gracefully and there's no user-visible surface to retry for).
//
// Never blocks the render; swallows all errors (Sentry captures them).
export async function maybeTriggerEmailBackfill(args: {
  userId: string;
  gmailConnected: boolean;
}): Promise<void> {
  if (!args.gmailConnected) return;

  try {
    const [row] = await db
      .select({ emailBackfillCompletedAt: users.emailBackfillCompletedAt })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);
    if (!row) return;
    // Marker already set → backfill ran (or is in flight). Never re-fire.
    if (row.emailBackfillCompletedAt) return;

    const now = new Date();
    // Optimistic stamp BEFORE publish, same pattern as
    // maybeTriggerAutoIngest's last_gmail_ingest_at write.
    await db
      .update(users)
      .set({ emailBackfillCompletedAt: now, updatedAt: now })
      .where(eq(users.id, args.userId));

    await qstash().publishJSON({
      url: `${env().APP_URL}/api/cron/email-backfill`,
      body: { userId: args.userId },
      retries: 1,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_backfill", op: "enqueue" },
      user: { id: args.userId },
    });
  }
}
