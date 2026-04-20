import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections, registeredResources } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
export {
  serializeContextForPrompt,
  type UserContextPayload,
} from "./serialize-context";
import type { UserContextPayload } from "./serialize-context";

export async function buildUserContext(userId: string): Promise<UserContextPayload> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);

  const resources = conn
    ? await db
        .select()
        .from(registeredResources)
        .where(
          and(
            eq(registeredResources.userId, userId),
            isNull(registeredResources.archivedAt)
          )
        )
    : [];

  return {
    notion: {
      connected: !!conn,
      parentPageId: conn?.parentPageId ?? null,
      classesDbId: conn?.classesDbId ?? null,
      mistakesDbId: conn?.mistakesDbId ?? null,
      assignmentsDbId: conn?.assignmentsDbId ?? null,
      syllabiDbId: conn?.syllabiDbId ?? null,
    },
    registeredResources: resources.map((r) => ({
      kind: r.resourceType,
      notionId: r.notionId,
      title: r.title,
    })),
  };
}
