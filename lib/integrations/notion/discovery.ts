import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections, registeredResources, auditLog } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "./client";
import type { Client } from "@notionhq/client";

export type DiscoveryChild = {
  notionId: string;
  kind: "database" | "page";
  title: string | null;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: DiscoveryResult }>();

export type DiscoveryResult = {
  inserted: string[];
  archived: string[];
  unchanged: number;
};

export function clearDiscoveryCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function discoverResources(
  userId: string,
  opts: { force?: boolean; now?: number; client?: Client } = {}
): Promise<DiscoveryResult> {
  const now = opts.now ?? Date.now();
  if (!opts.force) {
    const hit = cache.get(userId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.result;
  }

  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);
  if (!conn || !conn.parentPageId) {
    const empty: DiscoveryResult = { inserted: [], archived: [], unchanged: 0 };
    cache.set(userId, { at: now, result: empty });
    return empty;
  }

  const client = opts.client ?? notionClientFromToken(decrypt(conn.accessTokenEncrypted));
  const discovered = await listChildrenUnder(client, conn.parentPageId);
  const discoveredById = new Map(discovered.map((d) => [d.notionId, d]));

  const existing = await db
    .select()
    .from(registeredResources)
    .where(
      and(
        eq(registeredResources.userId, userId),
        eq(registeredResources.connectionId, conn.id),
        isNull(registeredResources.archivedAt)
      )
    );
  const existingByNotionId = new Map(existing.map((r) => [r.notionId, r]));

  const inserted: string[] = [];
  const archived: string[] = [];
  let unchanged = 0;

  for (const child of discovered) {
    if (existingByNotionId.has(child.notionId)) {
      unchanged += 1;
      continue;
    }
    await db.insert(registeredResources).values({
      userId,
      connectionId: conn.id,
      resourceType: child.kind,
      notionId: child.notionId,
      title: child.title,
      parentNotionId: conn.parentPageId,
      autoRegistered: 1,
    });
    inserted.push(child.notionId);
  }

  for (const row of existing) {
    if (!row.parentNotionId || row.parentNotionId !== conn.parentPageId) continue;
    if (row.notionId === conn.parentPageId) continue;
    if (discoveredById.has(row.notionId)) continue;
    await db
      .update(registeredResources)
      .set({ archivedAt: new Date(now) })
      .where(eq(registeredResources.id, row.id));
    archived.push(row.notionId);
  }

  if (inserted.length || archived.length) {
    await db.insert(auditLog).values({
      userId,
      action: "notion.discovery",
      resourceType: "notion_workspace",
      resourceId: conn.workspaceId,
      result: "success",
      detail: { inserted: inserted.length, archived: archived.length, unchanged },
    });
  }

  const result: DiscoveryResult = { inserted, archived, unchanged };
  cache.set(userId, { at: now, result });
  return result;
}

async function listChildrenUnder(
  client: Client,
  parentPageId: string
): Promise<DiscoveryChild[]> {
  const out: DiscoveryChild[] = [];
  let cursor: string | undefined;
  do {
    const resp = await client.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of resp.results) {
      if (!("type" in block)) continue;
      if (block.type === "child_database") {
        out.push({
          notionId: block.id,
          kind: "database",
          title: block.child_database.title || null,
        });
      } else if (block.type === "child_page") {
        out.push({
          notionId: block.id,
          kind: "page",
          title: block.child_page.title || null,
        });
      }
    }
    cursor = resp.next_cursor ?? undefined;
  } while (cursor);
  return out;
}
