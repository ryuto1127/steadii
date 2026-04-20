import "server-only";
import type { Client } from "@notionhq/client";

// Notion API 2025-09-03 (SDK v5) split "database" into a container + one or
// more "data sources". Querying rows and referencing a table's schema now
// happens through the data source ID, not the database ID.
//
// Our schema still stores Notion *database* IDs (classesDbId, mistakesDbId,
// etc. on notion_connections). To avoid a DB migration we resolve the data
// source lazily, with a module-level cache so repeated calls within a warm
// serverless instance only pay the lookup once.
const CACHE = new Map<string, string>();

export async function resolveDataSourceId(
  client: Client,
  databaseId: string
): Promise<string> {
  const cached = CACHE.get(databaseId);
  if (cached) return cached;

  const db = (await client.databases.retrieve({
    database_id: databaseId,
  })) as unknown as {
    data_sources?: Array<{ id: string }>;
  };
  const first = db.data_sources?.[0]?.id;
  if (!first) {
    throw new Error(
      `Notion database ${databaseId} has no data sources — cannot query rows.`
    );
  }
  CACHE.set(databaseId, first);
  return first;
}

export function primeDataSourceCache(
  databaseId: string,
  dataSourceId: string
): void {
  CACHE.set(databaseId, dataSourceId);
}

export function __resetDataSourceCacheForTests(): void {
  CACHE.clear();
}
