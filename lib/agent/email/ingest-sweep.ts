import "server-only";

import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, like } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";
import { ingestLast24h } from "@/lib/agent/email/ingest-recent";
import { decayUrgentInboxItems } from "@/lib/agent/email/urgency-decay";

// 2026-05-22 — Periodic Gmail ingest fan-out, factored out of
// app/api/cron/ingest-sweep/route.ts so the master-sweep cron can
// share the implementation. The original route remains intact (it
// also calls this function) as a manual admin trigger / safety net
// for the QStash schedule swap.
//
// The 24h cooldown that lives in `maybeTriggerAutoIngest` (lib/agent/
// email/auto-ingest.ts) is intentionally bypassed here — the cron is
// the periodic-refresh signal, so it calls `ingestLast24h` directly.
// `ingestLast24h` is idempotent via the
// UNIQUE(user_id, source_type, external_id) index on inbox_items so
// overlapping 24h windows between ticks don't duplicate rows.

export type IngestSweepResult = {
  tickAt: string;
  users: number;
  succeeded: number;
  failed: number;
  urgencyDecayed: number;
  failures?: Array<{ userId: string; message: string }>;
};

export async function runIngestSweep(): Promise<IngestSweepResult> {
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
    // the same tick. Failures here don't bump `failed` (the ingest
    // itself succeeded) but get their own Sentry breadcrumb.
    try {
      urgencyDecayed += await decayUrgentInboxItems(userId);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "ingest_sweep_cron", phase: "urgency_decay" },
        user: { id: userId },
      });
    }
  }

  return {
    tickAt: new Date().toISOString(),
    users: rows.length,
    succeeded,
    failed,
    urgencyDecayed,
    ...(failures.length ? { failures } : {}),
  };
}
