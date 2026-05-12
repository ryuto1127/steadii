import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";
import { refreshWatch } from "@/lib/integrations/google/gmail-watch";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-43 — daily refresh of Gmail Push watches. Gmail enforces a
// hard 7-day TTL on every users.watch subscription; without this cron
// real-time read-state filtering on Type C cards silently breaks when
// the prior watch lapses. Refresh threshold is 24h (configured in
// gmail-watch.ts); the cron iterates every user with a Gmail-scoped
// account and refreshes only those whose watch is near-expiry.
//
// Idempotent: a user with no prior watch state gets one set up on first
// invocation, then daily refreshes thereafter. Users without
// Gmail-scoped accounts are skipped.
//
// Schedule: daily at 04:00 UTC via Upstash QStash. The memory note
// feedback_qstash_orphan_schedules.md applies — Ryuto adds this
// schedule via the Upstash console post-merge and must remove it if
// this route is ever deleted.
export async function POST(req: Request) {
  return withHeartbeat("gmail-watch-refresh", () =>
    Sentry.startSpan(
      { name: "cron.gmail_watch_refresh.tick", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }

        // Pull every user who has a linked Google account with a gmail
        // scope. The watch-helper itself enforces the scope again — the
        // join is just a cheap pre-filter so we don't iterate users who
        // can never have a watch active.
        const candidates = await db
          .select({ id: users.id })
          .from(users)
          .innerJoin(accounts, eq(accounts.userId, users.id))
          .where(
            and(
              isNull(users.deletedAt),
              eq(accounts.provider, "google"),
              isNotNull(accounts.scope)
            )
          );

        let refreshed = 0;
        let stillFresh = 0;
        let skipped = 0;
        let failed = 0;

        for (const u of candidates) {
          try {
            const outcome = await refreshWatch(u.id);
            if (outcome === "refreshed") refreshed++;
            else if (outcome === "still_fresh") stillFresh++;
            else if (outcome === "skipped") skipped++;
            else failed++;
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "gmail_watch_refresh" },
              user: { id: u.id },
            });
          }
        }

        return NextResponse.json({
          tickAt: new Date().toISOString(),
          considered: candidates.length,
          refreshed,
          stillFresh,
          skipped,
          failed,
        });
      }
    )
  );
}
