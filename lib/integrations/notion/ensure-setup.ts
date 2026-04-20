import "server-only";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  registeredResources,
  auditLog,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "./client";
import {
  runNotionSetup,
  NotionSetupNoAccessiblePageError,
  scoreSteadiiCandidates,
  decideSteadiiWinner,
  type NotionSetupResult,
  type DuplicateCandidate,
} from "./setup";
import { databaseStillExists } from "./probe";
import type { Client } from "@notionhq/client";

export type EnsureSetupOutcome =
  | { status: "already_complete"; result: NotionSetupResult }
  | { status: "freshly_set_up"; result: NotionSetupResult }
  | { status: "re_set_up"; result: NotionSetupResult; reason: "deleted_in_notion" | "forced" };

export class NotionNotConnectedForSetupError extends Error {
  code = "NOTION_NOT_CONNECTED" as const;
  constructor() {
    super("Notion is not connected for this user.");
  }
}

export async function ensureNotionSetup(
  userId: string,
  opts: { force?: boolean; client?: Client } = {}
): Promise<EnsureSetupOutcome> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);
  if (!conn) throw new NotionNotConnectedForSetupError();

  const client =
    opts.client ?? notionClientFromToken(decrypt(conn.accessTokenEncrypted));

  if (!opts.force && conn.classesDbId && conn.setupCompletedAt) {
    try {
      const alive = await databaseStillExists(client, conn.classesDbId);
      if (alive) {
        return {
          status: "already_complete",
          result: materialize(conn),
        };
      }
    } catch (err) {
      // network/transient — surface it rather than silently re-creating
      throw err;
    }
    // Dead DB → fall through and re-run setup
    return {
      status: "re_set_up",
      reason: "deleted_in_notion",
      result: await doFreshSetup(
        userId,
        conn.id,
        client,
        "deleted_in_notion",
        conn.parentPageId ?? null
      ),
    };
  }

  if (opts.force) {
    return {
      status: "re_set_up",
      reason: "forced",
      result: await doFreshSetup(
        userId,
        conn.id,
        client,
        "forced",
        conn.parentPageId ?? null
      ),
    };
  }

  return {
    status: "freshly_set_up",
    result: await doFreshSetup(
      userId,
      conn.id,
      client,
      "fresh",
      conn.parentPageId ?? null
    ),
  };
}

function materialize(conn: typeof notionConnections.$inferSelect): NotionSetupResult {
  return {
    parentPageId: conn.parentPageId!,
    classesDbId: conn.classesDbId!,
    mistakesDbId: conn.mistakesDbId!,
    assignmentsDbId: conn.assignmentsDbId!,
    syllabiDbId: conn.syllabiDbId!,
  };
}

async function doFreshSetup(
  userId: string,
  connectionId: string,
  client: Client,
  reason: string,
  storedParentPageId: string | null = null
): Promise<NotionSetupResult> {
  const resolver = async (candidates: DuplicateCandidate[]) => {
    const scores = await scoreSteadiiCandidates(client, candidates);
    const decision = decideSteadiiWinner(scores, storedParentPageId);
    if (decision.kind === "ambiguous") {
      await db.insert(auditLog).values({
        userId,
        action: "notion.setup.dedup.ambiguous",
        result: "failure",
        detail: {
          candidates: scores,
          storedParentPageId,
          reason: decision.reason,
        },
      });
      return { winnerId: null };
    }
    // Archive losers, one audit row each.
    for (const loserId of decision.loserIds) {
      try {
        await client.pages.update({ page_id: loserId, archived: true });
        await db.insert(auditLog).values({
          userId,
          action: "archive_duplicate_steadii_parent",
          resourceType: "notion_page",
          resourceId: loserId,
          result: "success",
          detail: {
            kept: decision.winnerId,
            archived: loserId,
            reason: decision.reason,
          },
        });
      } catch (err) {
        await db.insert(auditLog).values({
          userId,
          action: "archive_duplicate_steadii_parent",
          resourceType: "notion_page",
          resourceId: loserId,
          result: "failure",
          detail: {
            kept: decision.winnerId,
            reason: decision.reason,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
    return { winnerId: decision.winnerId };
  };

  let result: NotionSetupResult;
  try {
    result = await runNotionSetup(client, { resolveDuplicates: resolver });
  } catch (err) {
    await db.insert(auditLog).values({
      userId,
      action: "notion.setup.failed",
      result: "failure",
      detail: {
        reason,
        message: err instanceof Error ? err.message : String(err),
        type:
          err instanceof NotionSetupNoAccessiblePageError
            ? "no_accessible_page"
            : "other",
      },
    });
    throw err;
  }

  await db
    .update(notionConnections)
    .set({
      parentPageId: result.parentPageId,
      classesDbId: result.classesDbId,
      mistakesDbId: result.mistakesDbId,
      assignmentsDbId: result.assignmentsDbId,
      syllabiDbId: result.syllabiDbId,
      setupCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(notionConnections.id, connectionId));

  // Soft-archive any stale auto-registered resources that reference the old
  // parent — discovery will re-populate after this returns.
  await db
    .update(registeredResources)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(registeredResources.userId, userId),
        eq(registeredResources.connectionId, connectionId)
      )
    );

  await db.insert(registeredResources).values([
    {
      userId,
      connectionId,
      resourceType: "page",
      notionId: result.parentPageId,
      title: "Steadii",
      autoRegistered: 1,
    },
    {
      userId,
      connectionId,
      resourceType: "database",
      notionId: result.classesDbId,
      title: "Classes",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId,
      resourceType: "database",
      notionId: result.mistakesDbId,
      title: "Mistake Notes",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId,
      resourceType: "database",
      notionId: result.assignmentsDbId,
      title: "Assignments",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId,
      resourceType: "database",
      notionId: result.syllabiDbId,
      title: "Syllabi",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
  ]);

  await db.insert(auditLog).values({
    userId,
    action:
      reason === "deleted_in_notion"
        ? "notion.setup.re_run"
        : reason === "forced"
        ? "notion.setup.forced_re_run"
        : "notion.setup.completed",
    resourceType: "notion_workspace",
    resourceId: result.parentPageId,
    result: "success",
    detail: {
      parentPageId: result.parentPageId,
      databases: {
        classes: result.classesDbId,
        mistakes: result.mistakesDbId,
        assignments: result.assignmentsDbId,
        syllabi: result.syllabiDbId,
      },
      reason,
    },
  });

  return result;
}
