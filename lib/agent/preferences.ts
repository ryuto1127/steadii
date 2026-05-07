import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { ConfirmationMode } from "./confirmation";

export async function getUserConfirmationMode(userId: string): Promise<ConfirmationMode> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const mode = row?.preferences?.agentConfirmationMode;
  if (mode === "all" || mode === "none" || mode === "destructive_only") return mode;
  return "destructive_only";
}

export async function setUserConfirmationMode(
  userId: string,
  mode: ConfirmationMode
): Promise<void> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const next = { ...(row?.preferences ?? {}), agentConfirmationMode: mode };
  await db
    .update(users)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getUserTimezone(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.timezone ?? null;
}

// 2026-05-06 — locale for downstream prompt construction (L2 deep-pass
// reasoning lives in the inbox-detail draft-details panel post PR #167,
// so the LLM's output language must match the user's app locale).
// Returns "en" by default — most existing users haven't explicitly set
// the JP toggle.
export async function getUserLocale(userId: string): Promise<"en" | "ja"> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const locale = row?.preferences?.locale;
  return locale === "ja" ? "ja" : "en";
}

export async function setUserTimezone(userId: string, tz: string): Promise<void> {
  await db
    .update(users)
    .set({ timezone: tz, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Sets timezone only if the current value is NULL. Returns true if written.
// Used for browser auto-detection — we must never overwrite a user's manual
// choice with a detected value.
export async function setUserTimezoneIfUnset(
  userId: string,
  tz: string
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ timezone: tz, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.timezone)))
    .returning({ id: users.id });
  return updated.length > 0;
}

export type VoiceTriggerKey = "caps_lock" | "alt_right" | "meta_right";

export async function getUserVoiceTriggerKey(
  userId: string
): Promise<VoiceTriggerKey> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const key = row?.preferences?.voiceTriggerKey;
  if (key === "caps_lock" || key === "alt_right" || key === "meta_right")
    return key;
  return "caps_lock";
}

export async function setUserVoiceTriggerKey(
  userId: string,
  key: VoiceTriggerKey
): Promise<void> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const next = { ...(row?.preferences ?? {}), voiceTriggerKey: key };
  await db
    .update(users)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Lightweight runtime validation: Intl will throw for unknown IANA zones.
export function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
