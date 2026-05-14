import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { ConfirmationMode } from "./confirmation";
import {
  computeInferredWindow,
  MAX_ACCEPTED_SLOT_SAMPLES,
  type InferredWorkingHoursLocal,
} from "./empirical-window";

// Re-export for downstream callers that previously imported these from
// preferences.ts so the move doesn't ripple through every importer.
export { computeInferredWindow };
export type { InferredWorkingHoursLocal };

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

// engineer-54 — working hours window in user's profile TZ. Used by the
// agent SLOT FEASIBILITY CHECK to decide whether a proposed meeting slot
// is acceptable. Stored as HH:MM 24h strings; the actual TZ is derived
// from users.timezone (single source of truth, auto-follows on travel).
//
// α scope: only non-overnight windows (start < end). The save tool
// rejects overnight ranges so the prompt-side comparison stays a simple
// "is HH:MM in [start, end]" check; overnight support is post-α.

export type WorkingHoursLocal = {
  start: string;
  end: string;
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidWorkingHours(value: unknown): value is WorkingHoursLocal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.start !== "string" || typeof v.end !== "string") return false;
  if (!HHMM_RE.test(v.start) || !HHMM_RE.test(v.end)) return false;
  return hhmmToMinutes(v.start) < hhmmToMinutes(v.end);
}

export function hhmmToMinutes(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export async function getUserWorkingHours(
  userId: string
): Promise<WorkingHoursLocal | null> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const wh = row?.preferences?.workingHoursLocal;
  if (!wh) return null;
  if (!isValidWorkingHours(wh)) return null;
  return { start: wh.start, end: wh.end };
}

// engineer-56 — silent learning. Track each accepted slot the user
// picks (or that the agent emits in a reply draft) as a HH:MM data
// point in the user's profile TZ. After ≥ 3 samples, the agent's
// SLOT FEASIBILITY CHECK consumes an empirical window
// [min(samples), max(samples)] as a refinement over the norm default.
// Storage shape (in users.preferences JSONB — no schema migration):
//   acceptedSlotSamplesLocal: ["19:30", "20:00", "21:15", ...]
// Capped at MAX_ACCEPTED_SLOT_SAMPLES so the JSONB row stays small.
// The samples are stored as plain HH:MM strings; we don't carry the
// sender or the date — α scale doesn't need either to compute a window.
// Math + types live in `./empirical-window.ts` (pure module, no DB).

export async function recordAcceptedSlot(
  userId: string,
  hhmmUserLocal: string
): Promise<void> {
  if (!HHMM_RE.test(hhmmUserLocal)) {
    // Silently drop invalid input — Part-4 is best-effort learning, not
    // a user-facing API. Bad data shouldn't crash the gmail_send path.
    return;
  }
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const prefs = row?.preferences ?? {};
  const samples = Array.isArray(prefs.acceptedSlotSamplesLocal)
    ? prefs.acceptedSlotSamplesLocal.filter(
        (s): s is string => typeof s === "string" && HHMM_RE.test(s)
      )
    : [];
  samples.push(hhmmUserLocal);
  // Keep the most recent N — slot preferences drift (graduating to a
  // job, changing schools). LIFO retention.
  const trimmed = samples.slice(-MAX_ACCEPTED_SLOT_SAMPLES);
  const next = {
    ...prefs,
    acceptedSlotSamplesLocal: trimmed,
  };
  await db
    .update(users)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getInferredWorkingHours(
  userId: string
): Promise<InferredWorkingHoursLocal | null> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const samples = Array.isArray(row?.preferences?.acceptedSlotSamplesLocal)
    ? row.preferences.acceptedSlotSamplesLocal.filter(
        (s): s is string => typeof s === "string" && HHMM_RE.test(s)
      )
    : [];
  return computeInferredWindow(samples);
}

export async function setUserWorkingHours(
  userId: string,
  hours: WorkingHoursLocal
): Promise<void> {
  // Belt-and-suspenders at the API boundary — runtime validation in
  // case a caller passes raw / untyped data. The type guard narrows
  // `hours` to `never` in the failure branch (since the input type is
  // already WorkingHoursLocal), so we capture the bad values before
  // the throw rather than referencing them through the narrowed type.
  const badStart = hours.start;
  const badEnd = hours.end;
  if (!isValidWorkingHours(hours)) {
    throw new Error(
      `Invalid working hours: start=${badStart} end=${badEnd} — both must be HH:MM 24h and start < end (overnight ranges deferred post-α).`
    );
  }
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const next = {
    ...(row?.preferences ?? {}),
    workingHoursLocal: { start: hours.start, end: hours.end },
  };
  await db
    .update(users)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
