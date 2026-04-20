import "server-only";
import type { Client } from "@notionhq/client";

export async function databaseStillExists(
  client: Client,
  databaseId: string
): Promise<boolean> {
  try {
    await client.databases.retrieve({ database_id: databaseId });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export async function pageStillExists(
  client: Client,
  pageId: string
): Promise<boolean> {
  try {
    const page = (await client.pages.retrieve({ page_id: pageId })) as unknown as {
      archived?: boolean;
    };
    if (page.archived) return false;
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  const status =
    (err as unknown as { status?: number; code?: string }).status ?? null;
  const code = (err as unknown as { code?: string }).code ?? null;
  if (status === 404) return true;
  if (code === "object_not_found") return true;
  return (
    /object_not_found/i.test(msg) ||
    /Could not find (database|page|block)/i.test(msg)
  );
}
