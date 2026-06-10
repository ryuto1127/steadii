/**
 * scripts/cron-audit.ts
 *
 * READ-ONLY ops audit. Lists the live Upstash QStash schedules and diffs
 * them against the in-repo source of truth (lib/cron/manifest.ts), so the
 * console and the code can be reconciled by hand. Surfaces three kinds of
 * drift:
 *
 *   - missing:  in the manifest but NOT scheduled in QStash (a cron we
 *               believe runs but doesn't — silent outage).
 *   - extra:    scheduled in QStash but NOT in the manifest (an orphan
 *               schedule, e.g. a deleted route's leftover or a domain-
 *               migration duplicate — see feedback_qstash_orphan_schedules).
 *   - cadence:  scheduled but on a different crontab than the manifest
 *               recommends.
 *
 * It NEVER creates, updates, pauses, or deletes a schedule — there is no
 * write path in this script. Schedule mutations are a human action in the
 * Upstash console.
 *
 * Usage:
 *
 *   pnpm cron:audit                 # diff live schedules against the manifest
 *   pnpm cron:audit --json          # machine-readable diff
 *
 * Requires QSTASH_TOKEN in the environment. Env loading + server-only shim
 * are handled by scripts/_register.cjs.
 */
import { Client } from "@upstash/qstash";
import { CRON_MANIFEST } from "@/lib/cron/manifest";

type LiveSchedule = {
  scheduleId: string;
  cron: string;
  routePath: string;
  destination: string;
  isPaused: boolean;
};

type Diff = {
  missing: Array<{ name: string; route: string; cron: string }>;
  extra: Array<{
    scheduleId: string;
    routePath: string;
    cron: string;
    isPaused: boolean;
  }>;
  cadenceMismatch: Array<{
    name: string;
    route: string;
    expectedCron: string;
    liveCron: string;
  }>;
  matched: Array<{ name: string; route: string; cron: string }>;
};

// Pull the route path out of a full destination URL so we can match a
// schedule to a manifest entry regardless of host/domain (the
// .xyz → .com migration left orphan schedules pointed at the old host).
function routePathFromDestination(destination: string): string {
  try {
    return new URL(destination).pathname;
  } catch {
    // Already a bare path, or an unparseable value — return as-is so it
    // shows up verbatim in the "extra" bucket for a human to eyeball.
    return destination;
  }
}

async function listLiveSchedules(token: string): Promise<LiveSchedule[]> {
  const client = new Client({ token });
  // schedules.list() is a pure GET — no mutation.
  const schedules = await client.schedules.list();
  return schedules.map((s) => ({
    scheduleId: s.scheduleId,
    cron: s.cron,
    destination: s.destination,
    routePath: routePathFromDestination(s.destination),
    isPaused: s.isPaused,
  }));
}

function diffAgainstManifest(live: LiveSchedule[]): Diff {
  const diff: Diff = {
    missing: [],
    extra: [],
    cadenceMismatch: [],
    matched: [],
  };

  // Index live schedules by route path. Paused schedules are treated as
  // not-live for the "missing" check below (a paused schedule isn't
  // firing) but still surface if they drift on cadence.
  const liveByRoute = new Map<string, LiveSchedule>();
  for (const s of live) liveByRoute.set(s.routePath, s);

  const manifestRoutes = new Set(CRON_MANIFEST.map((c) => c.route));

  for (const entry of CRON_MANIFEST) {
    const match = liveByRoute.get(entry.route);
    if (!match || match.isPaused) {
      diff.missing.push({
        name: entry.name,
        route: entry.route,
        cron: entry.cron,
      });
      continue;
    }
    if (match.cron !== entry.cron) {
      diff.cadenceMismatch.push({
        name: entry.name,
        route: entry.route,
        expectedCron: entry.cron,
        liveCron: match.cron,
      });
    } else {
      diff.matched.push({
        name: entry.name,
        route: entry.route,
        cron: entry.cron,
      });
    }
  }

  for (const s of live) {
    if (!manifestRoutes.has(s.routePath)) {
      diff.extra.push({
        scheduleId: s.scheduleId,
        routePath: s.routePath,
        cron: s.cron,
        isPaused: s.isPaused,
      });
    }
  }

  return diff;
}

function printDiff(diff: Diff): void {
  const line = (s: string) => process.stdout.write(s + "\n");
  line("");
  line("Cron audit — live QStash schedules vs lib/cron/manifest.ts");
  line("==========================================================");

  line("");
  line(`MATCHED (${diff.matched.length}):`);
  for (const m of diff.matched) {
    line(`  OK   ${m.name.padEnd(20)} ${m.cron.padEnd(14)} ${m.route}`);
  }

  line("");
  line(`MISSING — in manifest, not live in QStash (${diff.missing.length}):`);
  if (diff.missing.length === 0) line("  (none)");
  for (const m of diff.missing) {
    line(`  MISS ${m.name.padEnd(20)} ${m.cron.padEnd(14)} ${m.route}`);
  }

  line("");
  line(`EXTRA — live in QStash, not in manifest (${diff.extra.length}):`);
  if (diff.extra.length === 0) line("  (none)");
  for (const e of diff.extra) {
    const paused = e.isPaused ? " [paused]" : "";
    line(`  XTRA ${e.scheduleId.padEnd(20)} ${e.cron.padEnd(14)} ${e.routePath}${paused}`);
  }

  line("");
  line(`CADENCE MISMATCH (${diff.cadenceMismatch.length}):`);
  if (diff.cadenceMismatch.length === 0) line("  (none)");
  for (const c of diff.cadenceMismatch) {
    line(
      `  DIFF ${c.name.padEnd(20)} manifest=${c.expectedCron} live=${c.liveCron} ${c.route}`
    );
  }
  line("");
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    process.stderr.write(
      "QSTASH_TOKEN is not set. This script reads the live QStash schedule " +
        "list and cannot run without it. Set QSTASH_TOKEN in .env.local " +
        "(read-only; this script never mutates schedules).\n"
    );
    process.exit(1);
  }

  const live = await listLiveSchedules(token);
  const diff = diffAgainstManifest(live);

  if (json) {
    process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
  } else {
    printDiff(diff);
  }

  // Exit non-zero on any drift so this can gate a CI/ops check later. The
  // exit code does NOT reflect any mutation — nothing is ever written.
  const drift =
    diff.missing.length + diff.extra.length + diff.cadenceMismatch.length;
  process.exit(drift === 0 ? 0 : 2);
}

main().catch((err) => {
  process.stderr.write(
    `cron-audit failed: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
