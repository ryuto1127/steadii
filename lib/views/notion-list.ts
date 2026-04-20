import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";

export type NotionRow = {
  id: string;
  url: string;
  properties: Record<string, unknown>;
};

export async function listFromDatabase(args: {
  userId: string;
  databaseSelector: "classesDbId" | "mistakesDbId" | "assignmentsDbId" | "syllabiDbId";
  limit?: number;
}): Promise<NotionRow[]> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, args.userId))
    .limit(1);
  const dbId = conn?.[args.databaseSelector];
  if (!conn || !dbId) return [];

  const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
  try {
    const dsId = await resolveDataSourceId(client, dbId);
    const resp = await client.dataSources.query({
      data_source_id: dsId,
      page_size: args.limit ?? 100,
    });
    return resp.results.map((r: unknown) => {
      const obj = r as {
        id: string;
        url?: string;
        properties: Record<string, unknown>;
      };
      return {
        id: obj.id,
        url: obj.url ?? "",
        properties: obj.properties ?? {},
      };
    });
  } catch (err) {
    console.error(`listFromDatabase(${args.databaseSelector}) failed`, err);
    return [];
  }
}

export function getTitle(row: NotionRow): string {
  for (const value of Object.values(row.properties)) {
    const v = value as {
      type?: string;
      title?: Array<{ plain_text?: string }>;
    };
    if (v?.type === "title" && v.title) {
      return v.title.map((t) => t.plain_text ?? "").join("") || "(untitled)";
    }
  }
  return "(untitled)";
}

export function getSelect(row: NotionRow, key: string): string | null {
  const v = row.properties[key] as
    | { type?: string; select?: { name?: string } | null }
    | undefined;
  return v?.select?.name ?? null;
}

export function getRichText(row: NotionRow, key: string): string {
  const v = row.properties[key] as
    | { type?: string; rich_text?: Array<{ plain_text?: string }> }
    | undefined;
  return v?.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";
}

export function getDate(row: NotionRow, key: string): string | null {
  const v = row.properties[key] as
    | { type?: string; date?: { start?: string } | null }
    | undefined;
  return v?.date?.start ?? null;
}

export function getMultiSelect(row: NotionRow, key: string): string[] {
  const v = row.properties[key] as
    | { type?: string; multi_select?: Array<{ name?: string }> }
    | undefined;
  return (v?.multi_select ?? []).map((t) => t.name ?? "").filter(Boolean);
}

export function getRelationIds(row: NotionRow, key: string): string[] {
  const v = row.properties[key] as
    | { type?: string; relation?: Array<{ id?: string }> }
    | undefined;
  return (v?.relation ?? []).map((r) => r.id ?? "").filter(Boolean);
}
