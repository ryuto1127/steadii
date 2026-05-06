import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import { logEmailAudit } from "./audit";

// engineer-33 — urgency-decay sweep. Runs alongside the per-user
// fan-out inside the existing 5-min ingest-sweep cron. For every
// `inbox_items` row whose `urgency_expires_at` has passed and which
// hasn't already been archived, flip the row to `auto_archived = true`
// (and `status = 'archived'` so it leaves the default Inbox view the
// way Wave 5's `maybeAutoArchive` does) and downgrade bucket/risk_tier
// so admin metrics see the actual landing state.
//
// Auto-archive (rather than a softer downgrade) chosen because OTPs
// past expiry are unambiguously useless. The user can still find them
// via the existing `Hidden ({n})` chip if they need to scrub a
// recovery code from their history.
export async function decayUrgentInboxItems(
  userId: string
): Promise<number> {
  const expired = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.autoArchived, false),
        isNull(inboxItems.deletedAt),
        sql`${inboxItems.urgencyExpiresAt} IS NOT NULL`,
        sql`${inboxItems.urgencyExpiresAt} < now()`
      )
    );
  if (expired.length === 0) return 0;

  const ids = expired.map((r) => r.id);
  await db
    .update(inboxItems)
    .set({
      bucket: "auto_low",
      riskTier: "low",
      autoArchived: true,
      status: "archived",
      updatedAt: new Date(),
    })
    .where(inArray(inboxItems.id, ids));

  // Per-row audit so the digest's "Steadii hid" section + activity
  // timeline can attribute each decay to its underlying email row.
  // Same `auto_archive` action as the Wave 5 helper; `reason` field
  // disambiguates urgency-decay events from confidence-gate hides.
  for (const id of ids) {
    await logEmailAudit({
      userId,
      action: "auto_archive",
      result: "success",
      resourceId: id,
      detail: { reason: "urgency_decay" },
    });
  }
  return ids.length;
}
