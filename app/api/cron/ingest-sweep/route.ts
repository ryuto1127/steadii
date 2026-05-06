import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";
import { ingestLast24h } from "@/lib/agent/email/ingest-recent";
import { decayUrgentInboxItems } from "@/lib/agent/email/urgency-decay";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Periodic Gmail ingest fan-out. Triggered by Upstash QStash (recommended
// every 15 minutes — see DEPLOY.md).
//
// The 24h cooldown lives in `maybeTriggerAutoIngest` (lib/agent/email/
// auto-ingest.ts) — it checks `users.last_gmail_ingest_at` and short-
// circuits if the last attempt was within 24h. That wrapper exists to
// stop repeated page renders from spamming Gmail. The cron path bypasses
// it simply by calling `ingestLast24h` directly; there is no
// source-arg-based opt-out — the bypass is "skip the wrapper."
//
// ingestLast24h is idempotent (UNIQUE(user_id, source_type, external_id)
// on inbox_items) so the 24h window overlap between ticks doesn't
// duplicate rows. Per-user Gmail API cost ≈ 1 list + N message-detail
// fetches; α scale × every-15-min stays well under Gmail's per-project
// quota. If any one user errors we keep going for the rest.
export async function POST(req: Request) {
  return withHeartbeat("ingest-sweep", () =>
    Sentry.startSpan(
      {
        name: "cron.ingest_sweep.tick",
        op: "cron",
      },
      async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const rows = await db
        .select({ userId: accounts.userId })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.userId))
        .where(
          and(
            eq(accounts.provider, "google"),
            like(accounts.scope, "%gmail%"),
            isNull(users.deletedAt)
          )
        );

      let succeeded = 0;
      let failed = 0;
      let urgencyDecayed = 0;
      const failures: Array<{ userId: string; message: string }> = [];

      for (const { userId } of rows) {
        try {
          await ingestLast24h(userId);
          succeeded++;
        } catch (err) {
          failed++;
          failures.push({
            userId,
            message: err instanceof Error ? err.message : String(err),
          });
          Sentry.captureException(err, {
            tags: { feature: "ingest_sweep_cron" },
            user: { id: userId },
          });
        }

        // engineer-33 — OTP / verification-code time-decay. Runs after
        // the ingest so any rows just stamped get a chance to decay on
        // the same tick (the 10-min window can elapse mid-tick if the
        // L1 stamp is at or before the start of the previous cron run).
        // Failures are isolated from the ingest counter — we record a
        // separate Sentry breadcrumb but don't bump `failed` since the
        // ingest itself succeeded.
        try {
          urgencyDecayed += await decayUrgentInboxItems(userId);
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: "ingest_sweep_cron", phase: "urgency_decay" },
            user: { id: userId },
          });
        }
      }

      return NextResponse.json({
        tickAt: new Date().toISOString(),
        users: rows.length,
        succeeded,
        failed,
        urgencyDecayed,
        ...(failures.length ? { failures } : {}),
      });
      }
    )
  );
}
