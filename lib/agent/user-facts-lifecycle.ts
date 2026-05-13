import type { UserFactCategory } from "@/lib/db/schema";

// engineer-48 — lifecycle defaults per user_fact category.
//
// Mem0-inspired: each category gets a typical TTL, a review cadence, and
// (optionally) a confidence half-life. The save_user_fact tool +
// settings upsert call lifecycleForCategory(category, now) to compute
// defaults; the caller can override per-row via explicit args.
//
// Edits to this table need to stay in sync with the dogfood scenarios
// documented in docs/handoffs/engineer-48-quality-trio.md.

export type UserFactLifecycle = {
  // ms-since-epoch — null means "no hard cutoff".
  expiresAt: Date | null;
  nextReviewAt: Date | null;
  decayHalfLifeDays: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function lifecycleForCategory(
  category: UserFactCategory | null,
  now: Date = new Date()
): UserFactLifecycle {
  const cat = category ?? "other";
  switch (cat) {
    case "location_timezone":
      // Locations are multi-year stable; never hard-expire. Re-check
      // yearly (people move).
      return {
        expiresAt: null,
        nextReviewAt: new Date(now.getTime() + 365 * DAY_MS),
        decayHalfLifeDays: null,
      };
    case "schedule":
      // A semester schedule is good for ~4 months. Review 20 days
      // before expiry so the user can refresh before the gap.
      return {
        expiresAt: new Date(now.getTime() + 120 * DAY_MS),
        nextReviewAt: new Date(now.getTime() + 100 * DAY_MS),
        decayHalfLifeDays: null,
      };
    case "academic":
      // Year/major/school changes slowly. Annual review, hard expiry
      // at year-end to force a refresh once a year.
      return {
        expiresAt: new Date(now.getTime() + 365 * DAY_MS),
        nextReviewAt: new Date(now.getTime() + 330 * DAY_MS),
        decayHalfLifeDays: null,
      };
    case "communication_style":
      // Tone preferences drift slowly; instead of a hard expiry, decay
      // confidence so older style facts have less weight if newer
      // contradicting facts land.
      return {
        expiresAt: null,
        nextReviewAt: null,
        decayHalfLifeDays: 30,
      };
    case "personal_pref":
      // Notification + behavior prefs are typically stable but worth a
      // periodic re-check. Half-year review, no hard expiry.
      return {
        expiresAt: null,
        nextReviewAt: new Date(now.getTime() + 180 * DAY_MS),
        decayHalfLifeDays: null,
      };
    case "other":
    default:
      return {
        expiresAt: null,
        nextReviewAt: new Date(now.getTime() + 180 * DAY_MS),
        decayHalfLifeDays: null,
      };
  }
}

// Re-saving a fact (chat tool re-call, settings re-edit, cron Confirm)
// bumps reviewedAt to now and recomputes nextReviewAt off the original
// category's cadence (re-based on the new "now"). expiresAt is also
// pushed forward — confirming a schedule fact resets the 4-month clock.
export function bumpedLifecycleOnReview(
  category: UserFactCategory | null,
  now: Date = new Date()
): UserFactLifecycle {
  return lifecycleForCategory(category, now);
}
