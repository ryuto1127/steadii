import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { notionConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, session.user.id))
    .limit(1);
  if (!conn || !conn.classesDbId) {
    return NextResponse.json({ classes: [] });
  }

  try {
    const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
    const resp = await client.databases.query({
      database_id: conn.classesDbId,
      page_size: 100,
    });
    const classes = resp.results.flatMap((r) => {
      const obj = r as unknown as {
        id: string;
        properties?: {
          Name?: { title?: Array<{ plain_text?: string }> };
          Status?: { select?: { name?: string } | null };
        };
      };
      const name = obj.properties?.Name?.title?.[0]?.plain_text;
      const status = obj.properties?.Status?.select?.name ?? "active";
      if (!name) return [];
      return [{ id: obj.id, name, status }];
    });
    return NextResponse.json({ classes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch_failed", classes: [] },
      { status: 500 }
    );
  }
}
