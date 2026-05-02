#!/usr/bin/env tsx
/* eslint-disable no-console */

// Wave 5 — synthetic soak test for pre-public hardening.
//
// Drives 50 concurrent virtual users through a normal usage pattern
// (mix of inbox load / chat / calendar / settings) for 60 minutes
// against a target Vercel deployment, capturing P95/P99 latency +
// error rate per route.
//
// Usage:
//   pnpm tsx scripts/soak-test.ts \
//     --target https://staging.mysteadii.com \
//     --bearer "<session-token>" \
//     --concurrency 50 \
//     --duration-min 60
//
// The `--bearer` flag is the Auth.js session cookie (`authjs.session-token`)
// for a test user with seeded data. The script does NOT create users —
// stand up a soak target with realistic fixtures first.
//
// Output: writes `docs/launch/soak-results.md` with the per-route
// percentiles + a one-line pass/fail summary.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Args = {
  target: string;
  bearer: string;
  concurrency: number;
  durationMin: number;
};

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) {
      args.set(k, "true");
    } else {
      args.set(k, v);
      i++;
    }
  }
  const target = args.get("target") ?? "http://localhost:3000";
  const bearer = args.get("bearer") ?? "";
  const concurrency = Number(args.get("concurrency") ?? "50");
  const durationMin = Number(args.get("duration-min") ?? "60");
  return { target, bearer, concurrency, durationMin };
}

type RouteHit = {
  path: string;
  status: number;
  ms: number;
};

const ROUTES = [
  { path: "/app", weight: 4 },
  { path: "/app/inbox", weight: 6 },
  { path: "/app/calendar", weight: 3 },
  { path: "/app/settings", weight: 2 },
  { path: "/api/health", weight: 1 },
];

function pickRoute(): string {
  const total = ROUTES.reduce((s, r) => s + r.weight, 0);
  const target = Math.random() * total;
  let cumulative = 0;
  for (const r of ROUTES) {
    cumulative += r.weight;
    if (target <= cumulative) return r.path;
  }
  return ROUTES[0].path;
}

async function virtualUser(
  args: Args,
  endsAt: number,
  hits: RouteHit[]
): Promise<void> {
  while (Date.now() < endsAt) {
    const path = pickRoute();
    const url = `${args.target}${path}`;
    const startedAt = Date.now();
    let status = 0;
    try {
      const res = await fetch(url, {
        headers: args.bearer
          ? { Cookie: `authjs.session-token=${args.bearer}` }
          : {},
        redirect: "manual",
      });
      status = res.status;
      // Drain body so HTTP/2 doesn't stall the connection
      await res.text().catch(() => "");
    } catch {
      status = 0;
    }
    hits.push({ path, status, ms: Date.now() - startedAt });
    // 1-3s think time between hits per VU — mirrors real usage
    await sleep(1000 + Math.random() * 2000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

function formatResults(args: Args, hits: RouteHit[]): string {
  const byPath = new Map<string, RouteHit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path) ?? [];
    arr.push(h);
    byPath.set(h.path, arr);
  }
  const lines: string[] = [];
  lines.push("# Soak test results");
  lines.push("");
  lines.push(`- Target: \`${args.target}\``);
  lines.push(`- Concurrency: ${args.concurrency} VU`);
  lines.push(`- Duration: ${args.durationMin} min`);
  lines.push(`- Total hits: ${hits.length}`);
  lines.push("");
  lines.push("## Per-route latency + error rate");
  lines.push("");
  lines.push("| Route | Hits | P50 (ms) | P95 (ms) | P99 (ms) | 5xx % |");
  lines.push("|---|---|---|---|---|---|");
  let overallErrors = 0;
  for (const [path, arr] of byPath.entries()) {
    const sorted = arr.map((h) => h.ms).sort((a, b) => a - b);
    const errors = arr.filter((h) => h.status >= 500 || h.status === 0).length;
    overallErrors += errors;
    const errorPct = arr.length === 0 ? 0 : (errors / arr.length) * 100;
    lines.push(
      `| ${path} | ${arr.length} | ${percentile(sorted, 50)} | ${percentile(sorted, 95)} | ${percentile(sorted, 99)} | ${errorPct.toFixed(2)}% |`
    );
  }
  lines.push("");
  const overallErrorPct =
    hits.length === 0 ? 0 : (overallErrors / hits.length) * 100;
  const pass = overallErrorPct < 1.0;
  lines.push(
    `**Overall**: ${overallErrorPct.toFixed(2)}% error rate. ${
      pass ? "PASS (under 1.0% threshold)" : "FAIL (over 1.0% threshold)"
    }.`
  );
  lines.push("");
  lines.push(
    "Pass criteria: P95 < 1500ms on `/app` and `/app/inbox`; overall 5xx rate < 1.0%; no `/api/health` failures."
  );
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bearer) {
    console.warn(
      "[soak] no --bearer provided — running unauthenticated (will hit redirects)"
    );
  }
  const endsAt = Date.now() + args.durationMin * 60 * 1000;
  const hits: RouteHit[] = [];
  console.log(
    `[soak] starting ${args.concurrency} VU × ${args.durationMin}m against ${args.target}`
  );
  const vus: Promise<void>[] = [];
  for (let i = 0; i < args.concurrency; i++) {
    vus.push(virtualUser(args, endsAt, hits));
  }
  // Periodic progress
  const progressTimer = setInterval(() => {
    const remainingMs = Math.max(0, endsAt - Date.now());
    console.log(
      `[soak] progress: ${hits.length} hits, ${Math.round(remainingMs / 1000)}s remaining`
    );
  }, 30 * 1000);
  await Promise.all(vus);
  clearInterval(progressTimer);

  const md = formatResults(args, hits);
  const out = resolve("docs/launch/soak-results.md");
  writeFileSync(out, md);
  console.log(`[soak] wrote ${out} — ${hits.length} hits captured`);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
