import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { notionConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SyllabusWizard } from "@/components/syllabus/syllabus-wizard";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";
import { checkDatabaseHealth } from "@/lib/views/notion-health";
import { DeadDbBanner } from "@/components/views/dead-db-banner";

export const dynamic = "force-dynamic";

export default async function NewSyllabusPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const health = await checkDatabaseHealth({
    userId,
    databaseSelector: "syllabiDbId",
  });
  if (!health.ok) {
    return <DeadDbBanner title="Upload a syllabus" reason={health.reason} />;
  }

  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);

  let classes: Array<{ id: string; name: string }> = [];
  if (conn?.classesDbId) {
    try {
      const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
      const dsId = await resolveDataSourceId(client, conn.classesDbId);
      const resp = await client.dataSources.query({
        data_source_id: dsId,
        page_size: 100,
      });
      classes = resp.results.flatMap((r: unknown) => {
        const obj = r as {
          id: string;
          properties?: {
            Name?: { title?: Array<{ plain_text?: string }> };
          };
        };
        const name = obj.properties?.Name?.title?.[0]?.plain_text;
        return name ? [{ id: obj.id, name }] : [];
      });
    } catch (err) {
      console.error("Loading classes failed (non-fatal)", err);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl">Upload a syllabus</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Drop a PDF, an image, or paste a URL. We&apos;ll extract the structure and show you a preview before saving to Notion.
      </p>
      <SyllabusWizard
        classes={classes}
        blobConfigured={!!process.env.BLOB_READ_WRITE_TOKEN}
      />
    </div>
  );
}
