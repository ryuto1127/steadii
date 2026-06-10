import { describe, expect, it, vi } from "vitest";

// The cron manifest is the single source of truth for scheduled work.
// These tests pin its invariants and the derived heartbeat map, so the
// three-disagreeing-sources drift (heartbeat map vs DEPLOY.md vs route
// comments) can't silently reappear.

// The heartbeat module pulls @/lib/db/client (which constructs a neon
// client at import). Mock it so the heartbeat-derivation test loads in the
// node env without a live DATABASE_URL.
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ cronHeartbeats: {} }));

import {
  CRON_MANIFEST,
  CRON_NAMES,
  cronManifestByName,
} from "@/lib/cron/manifest";

describe("cron manifest — structural invariants", () => {
  it("every entry is fully populated and internally consistent", () => {
    for (const entry of CRON_MANIFEST) {
      expect(entry.name).toBeTruthy();
      expect(entry.route).toMatch(/^\/api\/cron\//);
      expect(entry.cron).toMatch(/^[\d*/, \-]+$/);
      expect(entry.expectedIntervalMs).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it("cron names are unique", () => {
    expect(new Set(CRON_NAMES).size).toBe(CRON_NAMES.length);
  });

  it("routes are unique", () => {
    const routes = CRON_MANIFEST.map((c) => c.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("excludes auto-cal-grace (deleted) and the master-sweep sub-sweeps", () => {
    // These either no longer exist (auto-cal-grace) or are consolidated
    // into master-sweep (no independent schedule). Listing them would
    // re-introduce the /api/health false positive PR #341 fixed.
    const names = new Set(CRON_NAMES);
    for (const excluded of [
      "auto-cal-grace",
      "pre-brief",
      "ingest-sweep",
      "draft-superseded",
      "digest",
      "weekly-digest",
      "send-queue",
    ]) {
      expect(names.has(excluded)).toBe(false);
    }
  });

  it("includes master-sweep and the independently-scheduled crons", () => {
    const names = new Set(CRON_NAMES);
    for (const present of [
      "master-sweep",
      "scanner",
      "groups",
      "ical-sync",
      "gmail-watch-refresh",
      "entity-backfill",
      "style-learner",
      "monthly-digest",
      "user-fact-review",
      "persona-learner",
    ]) {
      expect(names.has(present)).toBe(true);
    }
  });

  it("master-sweep is on a 15-minute cadence", () => {
    const ms = cronManifestByName().get("master-sweep");
    expect(ms?.cron).toBe("*/15 * * * *");
    expect(ms?.expectedIntervalMs).toBe(15 * 60 * 1000);
  });

  it("ical-sync is 6-hourly; the daily crons are 24h", () => {
    const by = cronManifestByName();
    expect(by.get("ical-sync")?.expectedIntervalMs).toBe(6 * 60 * 60 * 1000);
    for (const daily of [
      "scanner",
      "groups",
      "gmail-watch-refresh",
      "entity-backfill",
      "style-learner",
      "monthly-digest",
      "user-fact-review",
      "persona-learner",
    ]) {
      expect(by.get(daily)?.expectedIntervalMs).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("cron manifest — heartbeat map derivation", () => {
  it("CRON_EXPECTED_INTERVAL_MS is generated from the manifest, key-for-key", async () => {
    // Import lazily and shim server-only so the heartbeat module loads in
    // the node test env without a DB.
    const { CRON_EXPECTED_INTERVAL_MS } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    const expected = Object.fromEntries(
      CRON_MANIFEST.map((c) => [c.name, c.expectedIntervalMs])
    );
    expect(CRON_EXPECTED_INTERVAL_MS).toEqual(expected);
  });
});
