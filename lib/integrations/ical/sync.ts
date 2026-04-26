import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  events,
  icalSubscriptions,
  type IcalSubscription,
  type NewEventRow,
} from "@/lib/db/schema";
import { parseIcal } from "./parser";

export const ICAL_SYNC_WINDOW_DAYS = 60;
export const ICAL_FAILURE_DEACTIVATE_THRESHOLD = 3;

export type IcalSyncOutcome =
  | { status: "synced"; subscriptionId: string; eventsUpserted: number }
  | { status: "not_modified"; subscriptionId: string }
  | { status: "deactivated"; subscriptionId: string; reason: string }
  | { status: "failed"; subscriptionId: string; reason: string };

// `webcal://` is just a UI hint — the underlying transport is always HTTP(S).
// Apple Calendar and Outlook accept both schemes interchangeably.
function normaliseUrl(rawUrl: string): string {
  if (rawUrl.startsWith("webcal://"))
    return `https://${rawUrl.slice("webcal://".length)}`;
  if (rawUrl.startsWith("webcals://"))
    return `https://${rawUrl.slice("webcals://".length)}`;
  return rawUrl;
}

async function recordFailure(
  sub: IcalSubscription,
  reason: string
): Promise<IcalSyncOutcome> {
  const nextFailures = sub.consecutiveFailures + 1;
  const shouldDeactivate =
    nextFailures >= ICAL_FAILURE_DEACTIVATE_THRESHOLD;
  await db
    .update(icalSubscriptions)
    .set({
      consecutiveFailures: nextFailures,
      lastError: reason.slice(0, 500),
      active: shouldDeactivate ? false : sub.active,
    })
    .where(eq(icalSubscriptions.id, sub.id));
  if (shouldDeactivate) {
    return {
      status: "deactivated",
      subscriptionId: sub.id,
      reason,
    };
  }
  return { status: "failed", subscriptionId: sub.id, reason };
}

// Sync a single iCal subscription. Conditional on the stored ETag (Q3) — a
// 304 short-circuits before parsing. On parse success we replace the
// subscription's events for the [now, now+60d] window with the fetched set
// (delete-then-insert keyed on source_external_idx, scoped to this
// subscription via sourceAccountId=subscription.id). After 3 consecutive
// failures the row auto-deactivates per locked decision Q3.
export async function syncIcalSubscription(
  sub: IcalSubscription
): Promise<IcalSyncOutcome> {
  if (!sub.active) {
    return {
      status: "deactivated",
      subscriptionId: sub.id,
      reason: "subscription inactive",
    };
  }

  const url = normaliseUrl(sub.url);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        accept: "text/calendar, application/octet-stream;q=0.5",
        "user-agent": "Steadii-iCal-Sync/1.0",
        ...(sub.etag ? { "if-none-match": sub.etag } : {}),
      },
      // node-fetch / undici default: no auto-redirect-with-creds. iCal
      // servers commonly 301 webcal-ish endpoints to HTTPS — the default
      // follow behaviour is fine.
    });
  } catch (err) {
    return await recordFailure(
      sub,
      err instanceof Error ? err.message : String(err)
    );
  }

  if (resp.status === 304) {
    await db
      .update(icalSubscriptions)
      .set({
        lastSyncedAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
      })
      .where(eq(icalSubscriptions.id, sub.id));
    return { status: "not_modified", subscriptionId: sub.id };
  }

  if (!resp.ok) {
    return await recordFailure(sub, `HTTP ${resp.status}`);
  }

  const body = await resp.text();
  const newEtag = resp.headers.get("etag");

  let parsed;
  try {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + ICAL_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    parsed = parseIcal(body, { windowStart: now, windowEnd });
  } catch (err) {
    return await recordFailure(
      sub,
      `parse: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Upsert keyed on (userId, sourceType, externalId). The unique index
  // events_source_external_idx enforces this. We use ON CONFLICT to keep
  // the operation idempotent across overlapping syncs.
  let upserted = 0;
  if (parsed.length > 0) {
    const rows: NewEventRow[] = parsed.map((p) => ({
      userId: sub.userId,
      sourceType: "ical_subscription" as const,
      sourceAccountId: sub.id,
      externalId: p.recurrenceId ? `${p.uid}::${p.recurrenceId}` : p.uid,
      kind: "event" as const,
      title: p.title,
      description: p.description,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      isAllDay: p.isAllDay,
      location: p.location,
      url: p.url,
      status: p.status ?? "confirmed",
      sourceMetadata: { subscriptionId: sub.id, label: sub.label },
    }));

    await db
      .insert(events)
      .values(rows)
      .onConflictDoUpdate({
        target: [events.userId, events.sourceType, events.externalId],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          isAllDay: sql`excluded.is_all_day`,
          location: sql`excluded.location`,
          url: sql`excluded.url`,
          status: sql`excluded.status`,
          sourceMetadata: sql`excluded.source_metadata`,
          syncedAt: sql`now()`,
          updatedAt: sql`now()`,
          deletedAt: sql`NULL`,
        },
      });
    upserted = rows.length;
  }

  // Soft-delete events that vanished from the upstream feed (cancelled
  // class, removed assignment). Any row we OWN (this sub.id) that wasn't
  // in this sync gets `deleted_at` stamped so fanout queries skip it.
  // When `parsed` is empty we soft-delete every row owned by the sub —
  // an empty feed = the user removed everything upstream.
  const seenIds = parsed.map((p) =>
    p.recurrenceId ? `${p.uid}::${p.recurrenceId}` : p.uid
  );
  const deleteFilter =
    seenIds.length > 0
      ? and(
          eq(events.userId, sub.userId),
          eq(events.sourceType, "ical_subscription" as const),
          eq(events.sourceAccountId, sub.id),
          isNull(events.deletedAt),
          notInArray(events.externalId, seenIds)
        )
      : and(
          eq(events.userId, sub.userId),
          eq(events.sourceType, "ical_subscription" as const),
          eq(events.sourceAccountId, sub.id),
          isNull(events.deletedAt)
        );
  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(deleteFilter);

  await db
    .update(icalSubscriptions)
    .set({
      lastSyncedAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      etag: newEtag ?? sub.etag,
    })
    .where(eq(icalSubscriptions.id, sub.id));

  return {
    status: "synced",
    subscriptionId: sub.id,
    eventsUpserted: upserted,
  };
}
