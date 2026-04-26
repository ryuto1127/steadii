"use server";

import { and, eq } from "drizzle-orm";
import { auth, signIn } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { accounts, icalSubscriptions, events } from "@/lib/db/schema";
import { importNotionWorkspace } from "@/lib/integrations/notion/import-to-postgres";

export async function importNotionAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const summary = await importNotionWorkspace({ userId });
  const total =
    summary.classes.inserted +
    summary.classes.updated +
    summary.assignments.inserted +
    summary.assignments.updated +
    summary.mistakes.inserted +
    summary.mistakes.updated +
    summary.syllabi.inserted +
    summary.syllabi.updated;

  redirect(`/app/settings/connections?imported=${total}`);
}

// Phase 7 W-Integrations — Microsoft 365 connect / disconnect.
// Connect kicks off the standard NextAuth MS Entra flow; the redirect
// brings the user back here so the new account row is visible. Disconnect
// removes the linked accounts row only — no third-party revocation
// happens (the user can revoke from account.microsoft.com).
export async function connectMicrosoftAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await signIn("microsoft-entra-id", {
    redirectTo: "/app/settings/connections?ms=connected",
  });
}

export async function disconnectMicrosoftAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await db
    .delete(accounts)
    .where(
      and(
        eq(accounts.userId, session.user.id),
        eq(accounts.provider, "microsoft-entra-id")
      )
    );
  redirect("/app/settings/connections?ms=disconnected");
}

// Phase 7 W-Integrations — iCal subscriptions.
export async function addIcalSubscriptionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const rawUrl = formData.get("url");
  const label = formData.get("label");
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0)
    throw new Error("URL is required");

  // Normalise webcal → https for storage so the cron doesn't have to
  // re-do this on every tick. Validate the result is parseable.
  const candidate = rawUrl
    .trim()
    .replace(/^webcal:\/\//i, "https://")
    .replace(/^webcals:\/\//i, "https://");
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("Only HTTP(S) iCal URLs are supported.");
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }

  await db.insert(icalSubscriptions).values({
    userId,
    url: candidate,
    label:
      typeof label === "string" && label.trim().length > 0
        ? label.trim()
        : null,
  });

  redirect("/app/settings/connections?ical=added#ical");
}

export async function removeIcalSubscriptionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid id");

  // Soft-delete the events first (so a stale record can't surface in
  // fanout after the subscription is gone), then drop the subscription.
  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(events.userId, userId),
        eq(events.sourceType, "ical_subscription"),
        eq(events.sourceAccountId, id)
      )
    );
  await db
    .delete(icalSubscriptions)
    .where(
      and(
        eq(icalSubscriptions.userId, userId),
        eq(icalSubscriptions.id, id)
      )
    );

  redirect("/app/settings/connections?ical=removed#ical");
}

export async function reactivateIcalSubscriptionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid id");

  await db
    .update(icalSubscriptions)
    .set({ active: true, consecutiveFailures: 0, lastError: null })
    .where(
      and(
        eq(icalSubscriptions.userId, userId),
        eq(icalSubscriptions.id, id)
      )
    );

  redirect("/app/settings/connections?ical=reactivated#ical");
}
