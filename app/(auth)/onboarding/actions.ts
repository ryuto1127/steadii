"use server";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  registeredResources,
  auditLog,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import { runNotionSetup } from "@/lib/integrations/notion/setup";
import { parseNotionId } from "@/lib/integrations/notion/id";
import { discoverResources, clearDiscoveryCache } from "@/lib/integrations/notion/discovery";
import { redirect } from "next/navigation";

export async function runSetupAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);
  if (!conn) throw new Error("Notion not connected");
  if (conn.setupCompletedAt) {
    redirect("/onboarding?step=resources");
  }

  const token = decrypt(conn.accessTokenEncrypted);
  const client = notionClientFromToken(token);

  let result;
  try {
    result = await runNotionSetup(client);
  } catch (err) {
    await db.insert(auditLog).values({
      userId,
      action: "notion.setup.failed",
      result: "failure",
      detail: { message: err instanceof Error ? err.message : String(err) },
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
    .where(eq(notionConnections.id, conn.id));

  await db.insert(registeredResources).values([
    {
      userId,
      connectionId: conn.id,
      resourceType: "page",
      notionId: result.parentPageId,
      title: "Steadii",
      autoRegistered: 1,
    },
    {
      userId,
      connectionId: conn.id,
      resourceType: "database",
      notionId: result.classesDbId,
      title: "Classes",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId: conn.id,
      resourceType: "database",
      notionId: result.mistakesDbId,
      title: "Mistake Notes",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId: conn.id,
      resourceType: "database",
      notionId: result.assignmentsDbId,
      title: "Assignments",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
    {
      userId,
      connectionId: conn.id,
      resourceType: "database",
      notionId: result.syllabiDbId,
      title: "Syllabi",
      parentNotionId: result.parentPageId,
      autoRegistered: 1,
    },
  ]);

  await db.insert(auditLog).values({
    userId,
    action: "notion.setup.completed",
    resourceType: "notion_workspace",
    resourceId: conn.workspaceId,
    result: "success",
    detail: {
      parentPageId: result.parentPageId,
      databases: {
        mistakes: result.mistakesDbId,
        assignments: result.assignmentsDbId,
        syllabi: result.syllabiDbId,
      },
    },
  });

  clearDiscoveryCache(userId);
  try {
    await discoverResources(userId, { force: true });
  } catch (err) {
    console.error("Initial discovery failed", err);
  }

  redirect("/onboarding?step=resources");
}

export async function refreshResourcesAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await discoverResources(session.user.id, { force: true });
  redirect("/app/resources");
}

export async function disconnectNotionAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  await db.delete(notionConnections).where(eq(notionConnections.userId, userId));
  await db.insert(auditLog).values({
    userId,
    action: "notion.disconnected",
    result: "success",
  });
  redirect("/settings/connections");
}

export async function addResourceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const rawUrl = formData.get("notion_url");
  if (typeof rawUrl !== "string") throw new Error("Invalid URL");

  const notionId = parseNotionId(rawUrl);
  if (!notionId) throw new Error("Could not parse a Notion ID from that URL.");

  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);
  if (!conn) throw new Error("Notion not connected");

  await db.insert(registeredResources).values({
    userId,
    connectionId: conn.id,
    resourceType: "page",
    notionId,
    title: null,
    autoRegistered: 0,
  });

  redirect("/settings/resources");
}

export async function removeResourceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid id");

  await db
    .delete(registeredResources)
    .where(eq(registeredResources.id, id));

  redirect("/settings/resources");
}

