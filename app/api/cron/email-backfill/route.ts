import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { runEmailBackfill } from "@/lib/agent/email/backfill";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One-time 30-day email backfill — invoked as a QStash one-shot (NOT a
// recurring cron). maybeTriggerEmailBackfill (lib/agent/email/backfill.ts)
// publishes a single message with body { userId } when a user first
// connects Gmail; this route runs that user's 24h..30d backfill out of the
// page request lifecycle.
//
// The backfill is L1 triage + embeddings ONLY (the backfillMode gate in
// ingestSince) — no L2 / drafts / queue cards / notifications / auto-cal.
// Idempotency: the user-level email_backfill_completed_at marker is stamped
// at enqueue time so this never re-fires for a user; the per-message
// UNIQUE(user_id, source_type, external_id) on inbox_items makes a retry of
// the same message a no-op.
export async function POST(req: Request) {
  return withHeartbeat("email-backfill", () =>
    Sentry.startSpan(
      {
        name: "cron.email_backfill.run",
        op: "cron",
      },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        let userId: string | null = null;
        try {
          const parsed = JSON.parse(rawBody) as { userId?: unknown };
          if (typeof parsed.userId === "string" && parsed.userId.length > 0) {
            userId = parsed.userId;
          }
        } catch {
          userId = null;
        }
        if (!userId) {
          return NextResponse.json(
            { error: "missing_user_id" },
            { status: 400 }
          );
        }

        try {
          const summary = await runEmailBackfill(userId);
          return NextResponse.json({
            ranAt: new Date().toISOString(),
            scanned: summary.scanned,
            created: summary.created,
            skipped: summary.skipped,
            durationMs: summary.durationMs,
          });
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: "email_backfill", phase: "run_cron" },
            user: { id: userId },
          });
          return NextResponse.json(
            {
              error: "backfill_failed",
              message: err instanceof Error ? err.message : String(err),
            },
            { status: 500 }
          );
        }
      }
    )
  );
}
