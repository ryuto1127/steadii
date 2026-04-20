import "server-only";
import { Client } from "@notionhq/client";
import { db } from "@/lib/db/client";
import { notionConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";

export async function getNotionClientForUser(userId: string): Promise<{
  client: Client;
  connection: typeof notionConnections.$inferSelect;
} | null> {
  const rows = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);
  const connection = rows[0];
  if (!connection) return null;

  const token = decrypt(connection.accessTokenEncrypted);
  return { client: new Client({ auth: token }), connection };
}

export function notionClientFromToken(token: string): Client {
  return new Client({ auth: token });
}
