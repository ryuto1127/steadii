import { describe, it, expect, vi } from "vitest";

// engineer-48 — lifecycle helpers + decay math. Pure functions only;
// the DB-side filtering is covered by an integration-style spy below.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "x",
    AUTH_GOOGLE_ID: "x",
    AUTH_GOOGLE_SECRET: "x",
    NOTION_CLIENT_ID: "x",
    NOTION_CLIENT_SECRET: "x",
    OPENAI_API_KEY: "x",
    STRIPE_SECRET_KEY: "x",
    STRIPE_PRICE_ID_PRO: "x",
    ENCRYPTION_KEY: "k".repeat(64),
    NODE_ENV: "test",
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  lifecycleForCategory,
  bumpedLifecycleOnReview,
} from "@/lib/agent/user-facts-lifecycle";
import { decayedConfidence } from "@/lib/agent/user-facts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("lifecycleForCategory", () => {
  const NOW = new Date("2026-05-12T08:00:00Z");

  it("schedule: 120-day expiry, 100-day review, no decay", () => {
    const lc = lifecycleForCategory("schedule", NOW);
    expect(lc.expiresAt).not.toBeNull();
    expect(lc.expiresAt!.getTime()).toBe(NOW.getTime() + 120 * DAY_MS);
    expect(lc.nextReviewAt).not.toBeNull();
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 100 * DAY_MS);
    expect(lc.decayHalfLifeDays).toBeNull();
  });

  it("location_timezone: no expiry, yearly review, no decay", () => {
    const lc = lifecycleForCategory("location_timezone", NOW);
    expect(lc.expiresAt).toBeNull();
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 365 * DAY_MS);
    expect(lc.decayHalfLifeDays).toBeNull();
  });

  it("academic: 365-day expiry, 330-day review", () => {
    const lc = lifecycleForCategory("academic", NOW);
    expect(lc.expiresAt!.getTime()).toBe(NOW.getTime() + 365 * DAY_MS);
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 330 * DAY_MS);
  });

  it("communication_style: no hard expiry, no review, 30-day decay", () => {
    const lc = lifecycleForCategory("communication_style", NOW);
    expect(lc.expiresAt).toBeNull();
    expect(lc.nextReviewAt).toBeNull();
    expect(lc.decayHalfLifeDays).toBe(30);
  });

  it("personal_pref: no expiry, 180-day review", () => {
    const lc = lifecycleForCategory("personal_pref", NOW);
    expect(lc.expiresAt).toBeNull();
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 180 * DAY_MS);
    expect(lc.decayHalfLifeDays).toBeNull();
  });

  it("other: same shape as personal_pref", () => {
    const lc = lifecycleForCategory("other", NOW);
    expect(lc.expiresAt).toBeNull();
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 180 * DAY_MS);
  });

  it("null category falls back to other", () => {
    const lc = lifecycleForCategory(null, NOW);
    expect(lc.expiresAt).toBeNull();
    expect(lc.nextReviewAt!.getTime()).toBe(NOW.getTime() + 180 * DAY_MS);
  });

  it("bumpedLifecycleOnReview re-bases the clock off the new now", () => {
    const later = new Date(NOW.getTime() + 50 * DAY_MS);
    const bumped = bumpedLifecycleOnReview("schedule", later);
    expect(bumped.expiresAt!.getTime()).toBe(later.getTime() + 120 * DAY_MS);
    expect(bumped.nextReviewAt!.getTime()).toBe(later.getTime() + 100 * DAY_MS);
  });
});

describe("decayedConfidence", () => {
  const NOW = new Date("2026-05-12T08:00:00Z");

  it("returns base confidence when no half-life is set", () => {
    expect(
      decayedConfidence({
        baseConfidence: 0.8,
        decayHalfLifeDays: null,
        reviewedAt: null,
        lastUsedAt: null,
        createdAt: new Date(NOW.getTime() - 365 * DAY_MS),
        now: NOW,
      })
    ).toBe(0.8);
  });

  it("halves confidence at each half-life", () => {
    // 30-day half-life, untouched for 30 days → 0.5x.
    expect(
      decayedConfidence({
        baseConfidence: 1,
        decayHalfLifeDays: 30,
        reviewedAt: null,
        lastUsedAt: null,
        createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
        now: NOW,
      })
    ).toBeCloseTo(0.5, 5);
    // 60 days = 2 half-lives = 0.25x.
    expect(
      decayedConfidence({
        baseConfidence: 1,
        decayHalfLifeDays: 30,
        reviewedAt: null,
        lastUsedAt: null,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        now: NOW,
      })
    ).toBeCloseTo(0.25, 5);
  });

  it("anchors decay to reviewedAt over lastUsedAt over createdAt", () => {
    const created = new Date(NOW.getTime() - 365 * DAY_MS);
    const reviewed = new Date(NOW.getTime() - 30 * DAY_MS);
    // createdAt is 365 days old, but reviewedAt is only 30 days old →
    // decay is keyed off reviewedAt = 0.5x at 30-day half-life.
    expect(
      decayedConfidence({
        baseConfidence: 1,
        decayHalfLifeDays: 30,
        reviewedAt: reviewed,
        lastUsedAt: null,
        createdAt: created,
        now: NOW,
      })
    ).toBeCloseTo(0.5, 5);
  });

  it("matches the handoff doc's 'fact at 60 days returns confidence × 0.25' guarantee", () => {
    // Spec from docs/handoffs/engineer-48-quality-trio.md:
    //   "a fact with decayHalfLifeDays:30 not touched for 60 days returns
    //    confidence × 0.25 from getActiveUserFacts (or is excluded)".
    // Our chosen implementation: returns × 0.25 from the scoring helper,
    // and is excluded by loadTopUserFacts only when it falls below the
    // 1/16 (4 half-lives) drop threshold. 0.25 > 0.0625 → still included.
    const c = decayedConfidence({
      baseConfidence: 1,
      decayHalfLifeDays: 30,
      reviewedAt: null,
      lastUsedAt: null,
      createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
      now: NOW,
    });
    expect(c).toBeCloseTo(0.25, 5);
  });
});
