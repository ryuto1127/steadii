import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { runScanner } from "@/lib/agent/proactive/scanner";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Daily catch-all per D1: covers cases where data didn't change but a
// deadline drifted into a warning window (e.g., an exam now < 7 days
// away). Recommended QStash cadence: once per day, around 06:00 UTC so
// it lands before the morning digests at the user's local 7am.
//
// The cron source is special-cased in scanner.runScanner — it bypasses
// the per-user 5-minute debounce since its job IS to fire regardless.
export async function POST(req: Request) {
  return withHeartbeat("scanner", () =>
    Sentry.startSpan(
      { name: "cron.scanner.daily", op: "cron" },
      async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const eligibleUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            isNotNull(users.email),
            eq(users.digestEnabled, true)
          )
        );

      let scanned = 0;
      let proposalsCreated = 0;
      let failed = 0;

      for (const u of eligibleUsers) {
        try {
          const result = await runScanner(u.id, { source: "cron.daily" });
          scanned++;
          proposalsCreated += result.proposalsCreated;
        } catch (err) {
          failed++;
          Sentry.captureException(err, {
            tags: { feature: "scanner_cron" },
            user: { id: u.id },
          });
        }
      }

      return NextResponse.json({
        considered: eligibleUsers.length,
        scanned,
        proposalsCreated,
        failed,
      });
      }
    )
  );
}
