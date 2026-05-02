// Wave 2 per-archetype notification tier matrix.
//
// Spec table (`project_wave_2_home_design.md` § "Notification strategy"):
//
//   | Type        | Push (immediate)     | Daily digest      | In-Steadii |
//   |-------------|----------------------|-------------------|------------|
//   | A (Decision)| ✓                    | summary           | always     |
//   | B (Draft)   | batch 1×/day         | ✓                 | always     |
//   | C (Notice)  | none                 | ✓ (weekly summary)| always     |
//   | D (FYI)     | none                 | none              | always     |
//   | E (Clarify) | only if blocking I/O | none              | always     |
//
// In-Steadii (= the queue on Home) is always-on; users cannot disable
// it. The two configurable channels are push and digest. We model the
// user choice as a single tag per archetype:
//
//   - "push"    — immediate push (when STEADII_WEB_PUSH_ENABLED=true,
//                 falls back to digest otherwise).
//   - "digest"  — included in the daily digest email.
//   - "in_app"  — queue surface only; no external notification.
//
// "off" is intentionally not exposed — disabling the queue itself would
// make Steadii useless, and per spec the queue is always-on.

import type { QueueArchetype } from "@/lib/agent/queue/types";

export type NotificationChannel = "push" | "digest" | "in_app";

export type NotificationTierPrefs = Record<QueueArchetype, NotificationChannel>;

// Default routing per spec. The defaults are deliberately conservative:
// only A is set to push (the spec's "Immediate browser push" tier); B
// and C default to digest so the user gets a daily summary without
// being interrupted; D and E stay in-app only so the queue itself is
// the surface the user discovers them in.
export const DEFAULT_NOTIFICATION_TIER_PREFS: NotificationTierPrefs = {
  A: "push",
  B: "digest",
  C: "digest",
  D: "in_app",
  E: "in_app",
};

// Read a user's effective preferences from the JSONB blob, filling in
// archetype gaps with the default. The blob stores partial overrides
// only — unset archetypes stay on the default forever, so we never
// need to back-fill on save.
export function readTierPrefs(
  raw: unknown
): NotificationTierPrefs {
  if (!isObject(raw)) return { ...DEFAULT_NOTIFICATION_TIER_PREFS };
  const stored =
    isObject(raw.notificationTiers) ? raw.notificationTiers : null;
  if (!stored) return { ...DEFAULT_NOTIFICATION_TIER_PREFS };
  const out: NotificationTierPrefs = { ...DEFAULT_NOTIFICATION_TIER_PREFS };
  for (const arch of ["A", "B", "C", "D", "E"] as const) {
    const v = stored[arch];
    if (v === "push" || v === "digest" || v === "in_app") {
      out[arch] = v;
    }
  }
  return out;
}

// Resolve which channels actually fire for a given archetype. Returns
// the set of channels — multiple can fire at once when the user has
// chosen `push` (push fires immediately, the daily digest still
// includes a "summary" line per spec) or when push fallback hits.
export function channelsForArchetype(
  archetype: QueueArchetype,
  prefs: NotificationTierPrefs,
  webPushEnabled: boolean
): { push: boolean; digest: boolean; inApp: true } {
  const choice = prefs[archetype];
  // In-Steadii is always on per spec.
  const inApp = true as const;
  if (choice === "push") {
    if (webPushEnabled) return { push: true, digest: true, inApp };
    // Fall-back: when web push is gated off (Wave 2 default), the user
    // who chose "push" still gets the digest. This keeps the contract
    // honest: they wanted to know, we put it in their email.
    return { push: false, digest: true, inApp };
  }
  if (choice === "digest") return { push: false, digest: true, inApp };
  return { push: false, digest: false, inApp };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
