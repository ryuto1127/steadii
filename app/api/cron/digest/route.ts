import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { buildDigestPayload } from "@/lib/digest/build";
import { pickEligibleUsersForTick, markDigestSent } from "@/lib/digest/picker";
import {
  getFromAddress,
  resend,
  ResendNotConfiguredError,
} from "@/lib/integrations/resend/client";
import { logEmailAudit } from "@/lib/agent/email/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fires every 30 minutes via vercel.json. For each eligible user at the
// current tick, build a digest payload and dispatch via Resend.
// Failures are captured per-user — one bad user doesn't block the rest.
export async function GET(req: Request) {
  return Sentry.startSpan(
    {
      name: "cron.digest.tick",
      op: "cron",
    },
    async () => {
      const e = env();
      const authz = req.headers.get("authorization") ?? "";
      const ok =
        e.CRON_SECRET && authz === `Bearer ${e.CRON_SECRET}`
          ? true
          : e.NODE_ENV !== "production";
      if (!ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

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
            await resend().emails.send({
              from: getFromAddress(),
              to: payload.userEmail,
              subject: payload.subject,
              html: payload.html,
              text: payload.text,
            });
          } catch (err) {
            if (err instanceof ResendNotConfiguredError) {
              // In dev without the key, log but don't error — cron still
              // exercises the renderer + picker paths.
              console.warn(
                "[cron/digest] RESEND_API_KEY not set; skipping send"
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

      return NextResponse.json({
        tickAt: tickAt.toISOString(),
        considered: candidates.length,
        sent,
        skipped,
        failed,
      });
    }
  );
}
