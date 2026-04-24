"use server";

import { auth } from "@/lib/auth/config";
import { setUserConfirmationMode } from "@/lib/agent/preferences";
import type { ConfirmationMode } from "@/lib/agent/confirmation";
import { ingestLast24h } from "@/lib/agent/email/ingest-recent";
import { redirect } from "next/navigation";

export async function setConfirmationModeAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const raw = formData.get("mode");
  if (raw !== "destructive_only" && raw !== "all" && raw !== "none") {
    throw new Error("invalid mode");
  }
  await setUserConfirmationMode(session.user.id, raw as ConfirmationMode);
  redirect("/app/settings");
}

// Manual Gmail re-ingest. Needed for existing users who re-auth'd to
// pick up Gmail scope but never went through the onboarding flow that
// fires ingestLast24h automatically. Fire-and-forget — the server action
// awaits completion so we can redirect to /app/inbox and the user sees
// results. A self-log in ingestLast24h captures failures.
export async function refreshGmailInboxAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  try {
    await ingestLast24h(session.user.id);
  } catch (err) {
    console.error("[settings] manual Gmail ingest failed", err);
  }
  redirect("/app/inbox");
}
