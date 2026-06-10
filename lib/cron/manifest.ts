// ─── Cron manifest — single source of truth for scheduled work ───────
//
// Three in-repo sources used to describe the cron topology and disagree:
// the cron-heartbeat expected-interval map, DEPLOY.md §11, and each
// route's own header comment. Ground truth lived only in the Upstash
// console, so /api/health monitored a stale set (false positives on
// scanner/groups/ical-sync, blind to monthly-digest / user-fact-review /
// persona-learner).
//
// This manifest is now the ONE place that lists every LIVE QStash
// schedule. Everything downstream derives from it:
//   • lib/observability/cron-heartbeat.ts builds CRON_EXPECTED_INTERVAL_MS
//     from it, so /api/health monitors exactly this set.
//   • scripts/cron-audit.ts diffs it against the live QStash schedules.
//   • DEPLOY.md §11 is regenerated from it.
//
// INCLUSION RULE: a cron belongs here iff it owns its OWN live QStash
// schedule. The high-frequency sub-sweeps consolidated into master-sweep
// by PR #305 (pre-brief, ingest-sweep, draft-superseded, digest,
// weekly-digest, and the 30-min expiry sweeps) are NOT independently
// scheduled — master-sweep's heartbeat is their liveness signal and a
// sub-sweep failure surfaces via the Sentry capture tagged
// feature=master_sweep, sub_sweep=<name>. Listing them here would
// re-introduce the permanent-degraded false positive PR #341 fixed.
//
// CADENCE SOURCE: each route's own header comment is the authority. Where
// DEPLOY.md §11 disagreed, the route comment wins (the conflicts are
// listed in the PR body for console reconciliation). The `cron` field is
// the recommended QStash crontab; `expectedIntervalMs` is the same cadence
// in ms (the health monitor's staleness basis).

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CronManifestEntry = {
  // Heartbeat name — must match the `withHeartbeat("<name>", …)` wrapping
  // the route's POST handler.
  name: string;
  // App route the schedule POSTs to.
  route: string;
  // Recommended QStash crontab expression (the console is authoritative;
  // this is what it SHOULD be set to).
  cron: string;
  // Same cadence in milliseconds — the /api/health staleness basis.
  expectedIntervalMs: number;
  // One-line human description for DEPLOY.md regeneration.
  description: string;
};

export const CRON_MANIFEST: ReadonlyArray<CronManifestEntry> = [
  {
    name: "master-sweep",
    route: "/api/cron/master-sweep",
    cron: "*/15 * * * *",
    expectedIntervalMs: 15 * MINUTE_MS,
    description:
      "Consolidated master cron (PR #305). Fans out pre-brief + ingest-sweep every tick, the 30-min expiry/resurface sweeps at minute%30==0, and daily/weekly digest dispatch. Its heartbeat is the liveness signal for all consolidated sub-sweeps.",
  },
  {
    name: "entity-backfill",
    route: "/api/cron/entity-backfill",
    cron: "0 3 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 03:00 UTC. Drains pre-resolver source rows through the entity resolver (50/tick, 10/user) until the backlog idles to zero.",
  },
  {
    name: "gmail-watch-refresh",
    route: "/api/cron/gmail-watch-refresh",
    cron: "0 4 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 04:00 UTC. Refreshes Gmail Push watches before their 7-day TTL lapses; a missed run silently degrades the Type-C read filter.",
  },
  {
    name: "scanner",
    route: "/api/cron/scanner",
    cron: "0 6 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 06:00 UTC, before the morning digests. Catches deadline-drift proactive proposals (data unchanged but the warning window moved).",
  },
  {
    name: "groups",
    route: "/api/cron/groups",
    cron: "30 7 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 07:30 UTC, just after the digest. Auto-detects new group projects from email/calendar and runs silence detection across active ones.",
  },
  {
    name: "ical-sync",
    route: "/api/cron/ical-sync",
    cron: "0 */6 * * *",
    expectedIntervalMs: 6 * HOUR_MS,
    description:
      "Every 6 hours (Phase 7 W-Integrations Q3). Conditional-GETs active ical_subscriptions and upserts into the shared events mirror; auto-deactivates a URL after 3 consecutive failures.",
  },
  {
    name: "style-learner",
    route: "/api/cron/style-learner",
    cron: "0 8 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 08:00 UTC. Learns per-user writing style from (original, edited) draft feedback pairs (≥5 pairs).",
  },
  {
    name: "user-fact-review",
    route: "/api/cron/user-fact-review",
    cron: "0 8 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 08:00 UTC. Review sweep for aging user_facts (confidence decay / stale-fact retirement).",
  },
  {
    name: "monthly-digest",
    route: "/api/cron/monthly-digest",
    cron: "0 9 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 09:00 UTC. Per-user gate fires only on the first Sunday of the covered month in the user's local timezone; synthesizes the prior calendar month.",
  },
  {
    name: "persona-learner",
    route: "/api/cron/persona-learner",
    cron: "0 9 * * *",
    expectedIntervalMs: DAY_MS,
    description:
      "Daily 09:00 UTC. Learns contact personas from recent correspondence (7-day window; re-running on the same data is a near no-op).",
  },
];

// Convenience lookups derived from the manifest.
export const CRON_NAMES: ReadonlyArray<string> = CRON_MANIFEST.map(
  (c) => c.name
);

export function cronManifestByName(): Map<string, CronManifestEntry> {
  return new Map(CRON_MANIFEST.map((c) => [c.name, c]));
}
