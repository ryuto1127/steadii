"use server";

import { auth } from "@/lib/auth/config";
import { setUserConfirmationMode } from "@/lib/agent/preferences";
import type { ConfirmationMode } from "@/lib/agent/confirmation";
import { ingestLast24h } from "@/lib/agent/email/ingest-recent";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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

// W4.3 — flip the autonomy_send_enabled toggle. Pure persistence; the
// L2 orchestrator reads this on every triage tick so the next ingest
// cycle picks up the new value with no further wiring.
export async function setAutonomySendEnabledAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const enabled = formData.get("enabled") === "true";
  await db
    .update(users)
    .set({ autonomySendEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/app/settings");
}

// Wave 5 — flip the auto_archive_enabled toggle. Forward-looking: it
// gates future ingests, doesn't retroactively un-archive past hidden
// items (per locked design — the safety ramp depends on stable history
// during the 2-week window).
export async function setAutoArchiveEnabledAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const enabled = formData.get("enabled") === "true";
  await db
    .update(users)
    .set({ autoArchiveEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/app/settings");
  revalidatePath("/app/inbox");
}

// 2026-05-05 — voice input keyboard layout. Drives the trigger key
// the useVoiceInput hook listens for: en → Right Option, jn → Right ⌘.
// Stored on users.preferences.keyboardLayout (jsonb, no migration).
// Empty / "auto" drops the field so the client falls back to runtime
// detection via navigator.keyboard.getLayoutMap().
export async function setKeyboardLayoutAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const raw = formData.get("layout");
  if (raw !== "auto" && raw !== "en" && raw !== "jn") {
    throw new Error("invalid layout");
  }
  const userId = session.user.id;
  const expr =
    raw === "auto"
      ? sql`COALESCE(${users.preferences}, '{}'::jsonb) - 'keyboardLayout'`
      : sql`COALESCE(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ keyboardLayout: raw })}::jsonb`;
  await db
    .update(users)
    .set({ preferences: expr, updatedAt: new Date() })
    .where(eq(users.id, userId));
  revalidatePath("/app/settings");
}
