"use server";

import * as Sentry from "@sentry/nextjs";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth, signIn } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { accounts, icalSubscriptions, events, users } from "@/lib/db/schema";
import { importNotionWorkspace } from "@/lib/integrations/notion/import-to-postgres";
import {
  IcalSubscribeError,
  subscribeToIcal,
} from "@/lib/integrations/ical/subscribe";
import { reclassifyAllInboxItems } from "@/lib/agent/email/reclassify";
import { regenerateAllOpenDrafts } from "@/lib/agent/email/regenerate";
import {
  generateVoiceProfile,
  VoiceProfileNotEnoughSamplesError,
} from "@/lib/agent/email/voice-profile";

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

  try {
    await subscribeToIcal({
      userId,
      rawUrl,
      label: typeof label === "string" ? label : null,
    });
  } catch (err) {
    if (err instanceof IcalSubscribeError) {
      throw new Error(err.message);
    }
    throw err;
  }

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

// engineer-33 — GitHub username preference. Drives the L1 classifier's
// `@${username}` PR-promotion check. Stored in `users.preferences`
// (jsonb) so no schema migration. The form posts a possibly-empty
// string; empty drops the key from the jsonb so the L1 reads `null`
// and the promotion stops triggering.
//
// GitHub username spec: 1-39 chars, alphanumeric + single dashes
// between alphanumerics, may not start/end with a dash (matches
// github.com/settings/profile validation).
const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export async function setGithubUsernameAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const raw = formData.get("username");
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (trimmed.length > 0 && !GITHUB_USERNAME_RE.test(trimmed)) {
    redirect("/app/settings/connections?github=invalid");
  }

  // jsonb merge — set the field if non-empty, drop it if empty.
  // Avoids round-tripping the whole preferences blob and prevents a
  // concurrent setter from clobbering an unrelated key.
  const expr = trimmed
    ? sql`COALESCE(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ githubUsername: trimmed })}::jsonb`
    : sql`COALESCE(${users.preferences}, '{}'::jsonb) - 'githubUsername'`;
  await db
    .update(users)
    .set({ preferences: expr, updatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/app/settings/connections");
  redirect(
    `/app/settings/connections?github=${trimmed ? "saved" : "cleared"}`
  );
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

// Re-runs L1 over every open inbox_item for the current user. Useful
// after the classifier shipped new rules (e.g. engineer-32 GitHub-aware
// routing) that legacy items missed. Per-user scoped — never touches
// other users' rows.
export async function reclassifyAllInboxAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const out = await reclassifyAllInboxItems(userId);
  revalidatePath("/app/inbox");
  revalidatePath("/app/settings/connections");
  redirect(
    `/app/settings/connections?reclassify=ok&scanned=${out.scanned}&changed=${out.changed}&ignored=${out.ignoredAfter}#inbox`
  );
}

// engineer-36 — re-runs L2 deep + draft over the user's open agent_drafts.
// Capped at 10 per click so each invocation stays inside the Vercel
// server-action timeout. The UI offers "Run again to continue" via the
// `more=1` param when there's still queue. Bubbles credit exhaustion
// through `exhausted=1` so the banner can prompt a top-up.
export async function regenerateDraftsAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const out = await regenerateAllOpenDrafts(userId, { limit: 10 });
  revalidatePath("/app/inbox");
  revalidatePath("/app/settings/connections");
  redirect(
    `/app/settings/connections?regenerate=ok` +
      `&scanned=${out.scanned}` +
      `&refreshed=${out.refreshed}` +
      `&exhausted=${out.creditsExhausted ? 1 : 0}` +
      `&more=${out.hasMore ? 1 : 0}` +
      `#inbox`
  );
}

// engineer-38 — manual re-trigger for voice-profile extraction. Runs the
// full Gmail-fetch + GPT-5.4 pass inline (server actions get up to ~60s
// on Vercel; the call is ~5-10s). Surfaces three end states via query
// params: ok (saved), insufficient (<3 sent samples), error (caught).
//
// Voice-profile bootstrapping at first Gmail OAuth lives in the auth
// signIn callback (fire-and-forget). This action handles user-driven
// regeneration when their voice has shifted (e.g. they finished a term
// and want a refresh).
export async function regenerateVoiceProfileAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  try {
    await generateVoiceProfile(userId);
    redirect("/app/settings/connections?voice=ok#voice");
  } catch (err) {
    if (err instanceof VoiceProfileNotEnoughSamplesError) {
      redirect("/app/settings/connections?voice=insufficient#voice");
    }
    // Re-throw redirect signals (Next.js uses thrown redirects).
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    Sentry.captureException(err, {
      tags: { feature: "voice_profile", op: "regenerate" },
      user: { id: userId },
    });
    redirect("/app/settings/connections?voice=error#voice");
  }
}
