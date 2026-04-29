import "server-only";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, type EventRow, type NewEventRow } from "@/lib/db/schema";

export type SourceType =
  | "google_calendar"
  | "google_tasks"
  | "google_classroom_coursework"
  | "microsoft_graph"
  | "microsoft_todo";

export type Kind = "event" | "task" | "assignment";

export type CanonicalEvent = EventRow;

export type CanonicalEventInput = Omit<
  NewEventRow,
  "id" | "createdAt" | "updatedAt" | "syncedAt" | "deletedAt"
> & {
  syncedAt?: Date;
};

export type AdapterResult =
  | { ok: true; upserted: number; softDeleted: number }
  | { ok: false; error: string };

export type SyncAllResult = {
  bySource: Record<SourceType, AdapterResult>;
};

export async function listEventsInRange(
  userId: string,
  fromISO: string,
  toISO: string,
  opts?: {
    kinds?: Kind[];
    sourceTypes?: SourceType[];
    includeDeleted?: boolean;
  }
): Promise<CanonicalEvent[]> {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const conds = [
    eq(events.userId, userId),
    gte(events.startsAt, from),
    lt(events.startsAt, to),
  ];
  if (!opts?.includeDeleted) {
    conds.push(isNull(events.deletedAt));
  }
  if (opts?.kinds && opts.kinds.length > 0) {
    conds.push(
      sql`${events.kind} IN ${opts.kinds as readonly string[]}`
    );
  }
  if (opts?.sourceTypes && opts.sourceTypes.length > 0) {
    conds.push(
      sql`${events.sourceType} IN ${opts.sourceTypes as readonly string[]}`
    );
  }
  const rows = await db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(events.startsAt);
  return rows;
}

export async function upsertFromSourceRow(
  row: CanonicalEventInput
): Promise<void> {
  const now = new Date();
  await db
    .insert(events)
    .values({
      ...row,
      syncedAt: row.syncedAt ?? now,
      updatedAt: now,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: [events.userId, events.sourceType, events.externalId],
      set: {
        externalParentId: row.externalParentId ?? null,
        kind: row.kind,
        title: row.title,
        description: row.description ?? null,
        startsAt: row.startsAt,
        endsAt: row.endsAt ?? null,
        isAllDay: row.isAllDay ?? false,
        originTimezone: row.originTimezone ?? null,
        location: row.location ?? null,
        url: row.url ?? null,
        status: row.status ?? null,
        sourceMetadata: row.sourceMetadata ?? null,
        normalizedKey: row.normalizedKey ?? null,
        sourceAccountId: row.sourceAccountId,
        syncedAt: row.syncedAt ?? now,
        deletedAt: null,
        updatedAt: now,
      },
    });
}

export async function markDeletedByExternalId(
  userId: string,
  sourceType: SourceType,
  externalId: string
): Promise<void> {
  const now = new Date();
  await db
    .update(events)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(events.userId, userId),
        eq(events.sourceType, sourceType),
        eq(events.externalId, externalId)
      )
    );
}

// Simple in-memory TTL cache keyed by `${userId}:${from}:${to}`.
// Lives in the node process — fine for our single-region Next deploy.
const lastSyncedAt = new Map<string, number>();
const CACHE_MS = 60_000;

export function shouldSync(
  userId: string,
  fromISO: string,
  toISO: string
): boolean {
  const key = `${userId}:${fromISO}:${toISO}`;
  const t = lastSyncedAt.get(key);
  return !t || Date.now() - t > CACHE_MS;
}

export function markSynced(
  userId: string,
  fromISO: string,
  toISO: string
): void {
  const key = `${userId}:${fromISO}:${toISO}`;
  lastSyncedAt.set(key, Date.now());
}

export function clearEventSyncCache(userId?: string): void {
  if (!userId) {
    lastSyncedAt.clear();
    return;
  }
  for (const k of lastSyncedAt.keys()) {
    if (k.startsWith(`${userId}:`)) lastSyncedAt.delete(k);
  }
}

// Adapters register themselves at import time (avoids a cycle in imports —
// adapters import this file, this file is imported before them).
export type SyncAdapter = (
  userId: string,
  fromISO: string,
  toISO: string
) => Promise<AdapterResult>;

const adapters: Partial<Record<SourceType, SyncAdapter>> = {};

export function registerAdapter(source: SourceType, fn: SyncAdapter): void {
  adapters[source] = fn;
}

export async function syncAllForRange(
  userId: string,
  fromISO: string,
  toISO: string
): Promise<SyncAllResult> {
  // Lazy-import adapters so the registry is populated.
  await import("@/lib/sync/google-calendar");
  await import("@/lib/sync/google-tasks");
  await import("@/lib/sync/google-classroom");

  const sources: SourceType[] = [
    "google_calendar",
    "google_tasks",
    "google_classroom_coursework",
  ];
  const results = await Promise.all(
    sources.map(async (s): Promise<[SourceType, AdapterResult]> => {
      const fn = adapters[s];
      if (!fn) {
        return [s, { ok: false, error: "adapter not registered" }];
      }
      try {
        return [s, await fn(userId, fromISO, toISO)];
      } catch (err) {
        return [
          s,
          { ok: false, error: err instanceof Error ? err.message : String(err) },
        ];
      }
    })
  );
  const bySource = Object.fromEntries(results) as Record<
    SourceType,
    AdapterResult
  >;
  markSynced(userId, fromISO, toISO);
  return { bySource };
}

// Helper: find L4 rows for a (userId, sourceType) whose startsAt is in
// [from, to) and whose externalId is not in `keepIds`, then mark them deleted.
// Used by adapters for soft-delete reconciliation.
export async function softDeleteMissing(
  userId: string,
  sourceType: SourceType,
  fromISO: string,
  toISO: string,
  keepIds: Set<string>
): Promise<number> {
  const rows = await db
    .select({ id: events.id, externalId: events.externalId })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.sourceType, sourceType),
        gte(events.startsAt, new Date(fromISO)),
        lt(events.startsAt, new Date(toISO)),
        isNull(events.deletedAt)
      )
    );
  const stale = rows.filter((r) => !keepIds.has(r.externalId));
  if (stale.length === 0) return 0;
  const now = new Date();
  for (const r of stale) {
    await db
      .update(events)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(events.id, r.id));
  }
  return stale.length;
}

// Resolve the Google `providerAccountId` for a user. Future multi-account
// per provider will make this an array; for now we return the single match.
export async function getGoogleAccountId(userId: string): Promise<string | null> {
  const { accounts } = await import("@/lib/db/schema");
  const [row] = await db
    .select({ id: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  return row?.id ?? null;
}
