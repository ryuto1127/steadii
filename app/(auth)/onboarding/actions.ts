"use server";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  registeredResources,
  auditLog,
  users,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseNotionId } from "@/lib/integrations/notion/id";
import {
  discoverResources,
  clearDiscoveryCache,
} from "@/lib/integrations/notion/discovery";
import { ensureNotionSetup } from "@/lib/integrations/notion/ensure-setup";
import { redirect } from "next/navigation";

export async function runSetupAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  await ensureNotionSetup(userId);
  clearDiscoveryCache(userId);
  try {
    await discoverResources(userId, { force: true });
  } catch (err) {
    console.error("Initial discovery failed", err);
  }

  redirect("/app/settings/connections");
}

export async function repairSetupAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  await ensureNotionSetup(userId, { force: true });
  clearDiscoveryCache(userId);
  try {
    await discoverResources(userId, { force: true });
  } catch (err) {
    console.error("Discovery after repair failed", err);
  }

  redirect("/app/settings/connections?repaired=1");
}

export async function refreshResourcesAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await discoverResources(session.user.id, { force: true });
  redirect("/app/settings");
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
  redirect("/app/settings/connections");
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

  redirect("/app/settings");
}

// Phase 7 Pre-W1 cutover: the previous Notion-skip and Notion-finish
// actions have been removed. Onboarding is now a single Google-grant
// step; the first-24h Gmail ingest hook fires from
// `maybeTriggerAutoIngest` in /app/layout.tsx the moment the user lands
// on the app shell with the Gmail scope detected — so no onboarding
// action needs to schedule it explicitly anymore.

// Phase 7 W-Integrations — Step 2 skip-once. Stamp the user row so the
// integrations page never re-renders. Contextual prompts (Surface 2)
// remain active per locked decision Q1.
export async function skipIntegrationsStepAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await db
    .update(users)
    .set({ onboardingIntegrationsSkippedAt: new Date() })
    .where(eq(users.id, session.user.id));
  redirect("/app");
}

export async function removeResourceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid id");

  await db
    .delete(registeredResources)
    .where(eq(registeredResources.id, id));

  redirect("/app/settings");
}
