import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { icalSubscriptions } from "@/lib/db/schema";
import { syncIcalSubscription } from "@/lib/integrations/ical/sync";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cron: every 6 hours per locked decision Q3. Walks active subscriptions,
// fetches each (conditional GET via stored ETag), parses, upserts events.
// Per-subscription failures bump consecutive_failures; after 3 strikes the
// row auto-deactivates so we stop hammering a broken URL. Settings UI
// surfaces deactivated rows so the user can fix and reactivate.
export async function POST(req: Request) {
  return Sentry.startSpan(
    { name: "cron.ical_sync.tick", op: "cron" },
    async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const subs = await db
        .select()
        .from(icalSubscriptions)
        .where(eq(icalSubscriptions.active, true));

      let synced = 0;
      let notModified = 0;
      let failed = 0;
      let deactivated = 0;

      for (const sub of subs) {
        try {
          const outcome = await syncIcalSubscription(sub);
          if (outcome.status === "synced") synced++;
          else if (outcome.status === "not_modified") notModified++;
          else if (outcome.status === "deactivated") deactivated++;
          else failed++;
        } catch (err) {
          failed++;
          Sentry.captureException(err, {
            tags: { feature: "ical_sync_cron" },
            user: { id: sub.userId },
            extra: { subscriptionId: sub.id, url: sub.url },
          });
        }
      }

      return NextResponse.json({
        tickAt: new Date().toISOString(),
        considered: subs.length,
        synced,
        notModified,
        failed,
        deactivated,
      });
    }
  );
}
