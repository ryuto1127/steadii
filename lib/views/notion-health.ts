import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import { databaseStillExists } from "@/lib/integrations/notion/probe";

export type Health =
  | { ok: true; databaseId: string }
  | { ok: false; reason: "not_connected" | "not_set_up" | "deleted" };

export async function checkDatabaseHealth(args: {
  userId: string;
  databaseSelector:
    | "classesDbId"
    | "mistakesDbId"
    | "assignmentsDbId"
    | "syllabiDbId";
}): Promise<Health> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, args.userId))
    .limit(1);
  if (!conn) return { ok: false, reason: "not_connected" };
  const dbId = conn[args.databaseSelector];
  if (!dbId) return { ok: false, reason: "not_set_up" };

  try {
    const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
    const alive = await databaseStillExists(client, dbId);
    if (!alive) return { ok: false, reason: "deleted" };
    return { ok: true, databaseId: dbId };
  } catch (err) {
    // Transient errors shouldn't lock the user out of the view; treat as deleted
    // only on real 404s (databaseStillExists throws for non-404).
    console.error("checkDatabaseHealth transient error", err);
    return { ok: true, databaseId: dbId };
  }
}
