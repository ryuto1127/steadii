import "server-only";

import * as Sentry from "@sentry/nextjs";

import { buildDigestPayload } from "@/lib/digest/build";
import { pickEligibleUsersForTick, markDigestSent } from "@/lib/digest/picker";
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

// 2026-05-22 — Daily + weekly digest sweep, factored out of
// app/api/cron/digest/route.ts and app/api/cron/weekly-digest/route.ts
// so the master-sweep cron can share the implementation. The
// original routes remain intact (each also calls these functions) as
// manual admin triggers / safety nets for the QStash schedule swap.
//
// Eligibility (which users get a digest at this tick) is owned by
// the picker modules; the sweep here is just the build → send →
// stamp loop. Per-user failures are isolated.

export type DigestSweepResult = {
  kind: "daily" | "weekly";
  tickAt: string;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
};

export async function runDigestSweep(): Promise<DigestSweepResult> {
  const tickAt = new Date();
  const candidates = await pickEligibleUsersForTick(tickAt);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const payload = await buildDigestPayload(c.userId);
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
            `Resend rejected digest send: ${result.error.name} — ${result.error.message}`
          );
        }
      } catch (err) {
        if (err instanceof ResendNotConfiguredError) {
          console.warn(
            "[digest-sweep] RESEND_API_KEY not set; skipping send"
          );
          skipped++;
          continue;
        }
        throw err;
      }
      await markDigestSent(c.userId, tickAt);
      await logEmailAudit({
        userId: c.userId,
        action: "email_ingest_completed",
        result: "success",
        detail: {
          kind: "digest_sent",
          subject: payload.subject,
          itemCount: payload.items.length,
          highCount: payload.highCount,
          mediumCount: payload.mediumCount,
          lowCount: payload.lowCount,
        },
      });
      sent++;
    } catch (err) {
      failed++;
      Sentry.captureException(err, {
        tags: { feature: "digest_cron" },
        user: { id: c.userId },
      });
      try {
        await logEmailAudit({
          userId: c.userId,
          action: "email_ingest_failed",
          result: "failure",
          detail: {
            kind: "digest_send_failed",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // audit failure is non-fatal
      }
    }
  }

  return {
    kind: "daily",
    tickAt: tickAt.toISOString(),
    considered: candidates.length,
    sent,
    skipped,
    failed,
  };
}

export async function runWeeklyDigestSweep(): Promise<DigestSweepResult> {
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
            "[weekly-digest-sweep] RESEND_API_KEY not set; skipping send"
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

  return {
    kind: "weekly",
    tickAt: tickAt.toISOString(),
    considered: candidates.length,
    sent,
    skipped,
    failed,
  };
}
