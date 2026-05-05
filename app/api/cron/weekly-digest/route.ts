import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { buildWeeklyDigestPayload } from "@/lib/digest/weekly-build";
import {
  pickEligibleUsersForWeeklyTick,
  markWeeklyDigestSent,
} from "@/lib/digest/weekly-picker";
import {
  getFromAddress,
  resend,
  ResendNotConfiguredError,
} from "@/lib/integrations/resend/client";
import { logEmailAudit } from "@/lib/agent/email/audit";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Triggered by Upstash QStash on a cron schedule (configured in the QStash
// console — see DEPLOY.md). Recommended cadence: hourly. The internal
// Sunday-17:00 cross is the gate, not the QStash cadence — same pattern
// as the daily digest.
//
// For each eligible user at the current tick, build the weekly payload
// and dispatch via Resend. Failures are captured per-user — one bad
// user doesn't block the rest.
export async function POST(req: Request) {
  return withHeartbeat("weekly-digest", () =>
    Sentry.startSpan(
      {
        name: "cron.weekly-digest.tick",
        op: "cron",
      },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        const tickAt = new Date();
        const candidates = await pickEligibleUsersForWeeklyTick(tickAt);
        let sent = 0;
        let skipped = 0;
        let failed = 0;

        for (const c of candidates) {
          try {
            const payload = await buildWeeklyDigestPayload(c.userId, tickAt);
            if (!payload) {
              skipped++;
              continue;
            }
            try {
              const result = await resend().emails.send({
                from: getFromAddress(),
                to: payload.userEmail,
                subject: payload.subject,
                html: payload.html,
                text: payload.text,
              });
              if (result.error) {
                throw new Error(
                  `Resend rejected weekly digest send: ${result.error.name} — ${result.error.message}`
                );
              }
            } catch (err) {
              if (err instanceof ResendNotConfiguredError) {
                console.warn(
                  "[cron/weekly-digest] RESEND_API_KEY not set; skipping send"
                );
                skipped++;
                continue;
              }
              throw err;
            }
            await markWeeklyDigestSent(c.userId, tickAt);
            await logEmailAudit({
              userId: c.userId,
              action: "email_ingest_completed",
              result: "success",
              detail: {
                kind: "weekly_digest_sent",
                subject: payload.subject,
                archived: payload.stats.archivedCount,
                draftsSent: payload.stats.draftsSent,
                deadlines: payload.stats.deadlinesCaught,
                calendarImports: payload.stats.calendarImports,
                proposalsResolved: payload.stats.proposalsResolved,
                secondsSaved: payload.secondsSaved,
              },
            });
            sent++;
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "weekly_digest_cron" },
              user: { id: c.userId },
            });
            try {
              await logEmailAudit({
                userId: c.userId,
                action: "email_ingest_failed",
                result: "failure",
                detail: {
                  kind: "weekly_digest_send_failed",
                  message: err instanceof Error ? err.message : String(err),
                },
              });
            } catch {
              // audit failure is non-fatal
            }
          }
        }

        return NextResponse.json({
          tickAt: tickAt.toISOString(),
          considered: candidates.length,
          sent,
          skipped,
          failed,
        });
      }
    )
  );
}
