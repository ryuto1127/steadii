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
import { ingestLast24h } from "@/lib/agent/email/ingest-recent";
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

  redirect("/onboarding?step=resources");
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

// Records that the user explicitly skipped the optional Notion step. We
// use the `onboarding_step` column as the forward-only persistence for
// this: advancing it past 2 tells `stepFromStatus` not to land the user
// back on the Notion screen on the next visit.
export async function skipNotionAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const [row] = await db
    .select({ current: users.onboardingStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = row?.current ?? 0;
  if (current < 4) {
    await db
      .update(users)
      .set({ onboardingStep: 4, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
  // Kick off the first-24h ingest — fire-and-forget, so /app doesn't block.
  // ingestLast24h self-logs failures to audit_log; we catch here only to
  // make sure a thrown promise doesn't surface as an unhandled rejection.
  ingestLast24h(userId).catch((err) => {
    console.error("[onboarding] first-24h ingest failed (skip path)", err);
  });
  redirect("/app");
}

// Finish onboarding without skipping; used by the resources step.
export async function finishOnboardingAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  ingestLast24h(userId).catch((err) => {
    console.error("[onboarding] first-24h ingest failed (finish path)", err);
  });
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
