/**
 * scripts/wave5-ramp-report.ts
 *
 * Read-only Wave 5 auto-archive ramp report. Pulls auto-archive events
 * and user-initiated restores from prod since the ramp opened
 * (2026-05-02 per project_wave_5_design.md) and computes the
 * false-positive rate. Drives the flip / no-flip / extend decision for
 * AUTO_ARCHIVE_DEFAULT_ENABLED on ~2026-05-16.
 *
 * Self-contained — discovers the prod URL via Neon API + NEONCTL_API_KEY
 * in .env.local. Does not use lib/db/client (which defaults to the dev
 * DB).
 *
 * Usage:  pnpm tsx scripts/wave5-ramp-report.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const NEON_API_KEY = process.env.NEONCTL_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const NEON_PROD_BRANCH = process.env.NEON_PROD_BRANCH ?? "production";
const NEON_DATABASE = process.env.NEON_DATABASE ?? "neondb";
const NEON_ROLE = process.env.NEON_ROLE ?? "neondb_owner";

const RAMP_START = "2026-05-02";

async function neonApi<T>(p: string): Promise<T> {
  if (!NEON_API_KEY) throw new Error("NEONCTL_API_KEY missing from .env.local");
  const r = await fetch(`https://console.neon.tech/api/v2${p}`, {
    headers: { Authorization: `Bearer ${NEON_API_KEY}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Neon API ${p}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function getProdUrl(): Promise<string> {
  let projectId = NEON_PROJECT_ID;
  if (!projectId) {
    type Org = { id: string; name: string };
    type Proj = { id: string; name: string };
    let orgs: Org[] = [];
    try {
      const r = await neonApi<{ organizations: Org[] }>("/users/me/organizations");
      orgs = r.organizations ?? [];
    } catch {}
    const projects: Proj[] = [];
    if (orgs.length > 0) {
      for (const o of orgs) {
        try {
          const r = await neonApi<{ projects: Proj[] }>(
            `/projects?org_id=${encodeURIComponent(o.id)}`
          );
          projects.push(...(r.projects ?? []));
        } catch {}
      }
    } else {
      const r = await neonApi<{ projects: Proj[] }>("/projects");
      projects.push(...(r.projects ?? []));
    }
    const m = projects.find((p) => p.name.toLowerCase().includes("steadii"));
    if (!m) throw new Error(`No steadii project. Found: ${projects.map((p) => p.name).join(", ")}`);
    projectId = m.id;
  }
  type Branch = { id: string; name: string; primary?: boolean };
  const { branches } = await neonApi<{ branches: Branch[] }>(`/projects/${projectId}/branches`);
  const prod =
    branches.find((b) => b.name === NEON_PROD_BRANCH) ??
    branches.find((b) => b.name === "main") ??
    branches.find((b) => b.primary === true);
  if (!prod) throw new Error("No production branch found");

  type Endpoint = { id: string; host: string; type: string };
  const { endpoints } = await neonApi<{ endpoints: Endpoint[] }>(
    `/projects/${projectId}/branches/${prod.id}/endpoints`
  );
  const readWrite = endpoints.find((e) => e.type === "read_write");
  if (!readWrite) throw new Error("No read_write endpoint on prod branch");

  type Pwd = { password: string };
  const { password } = await neonApi<Pwd>(
    `/projects/${projectId}/branches/${prod.id}/roles/${NEON_ROLE}/reveal_password`
  );
  return `postgres://${NEON_ROLE}:${password}@${readWrite.host}/${NEON_DATABASE}?sslmode=require`;
}

async function main() {
  const url = await getProdUrl();
  const sql = neon(url);

  console.log(`\n=== Wave 5 auto-archive ramp report ===`);
  console.log(`Ramp start:    ${RAMP_START}`);
  console.log(`Report time:   ${new Date().toISOString()}`);
  console.log(``);

  // 1. Total Wave 5 classifier auto-archives since ramp start.
  //    Excludes urgency_decay events which share the 'auto_archive'
  //    action label but come from a different code path
  //    (lib/agent/email/urgency-decay.ts, not auto-archive.ts).
  //    Wave 5 rows have detail->bucket='auto_low'; urgency_decay rows
  //    have detail->reason='urgency_decay'.
  const totalRows = (await sql`
    SELECT COUNT(*)::text AS count
    FROM audit_log
    WHERE action = 'auto_archive'
      AND result = 'success'
      AND created_at >= ${RAMP_START}
      AND (detail->>'bucket') = 'auto_low'
  `) as { count: string }[];
  const totalArchives = Number(totalRows[0]?.count ?? 0);

  const urgencyRows = (await sql`
    SELECT COUNT(*)::text AS count
    FROM audit_log
    WHERE action = 'auto_archive'
      AND result = 'success'
      AND created_at >= ${RAMP_START}
      AND (detail->>'reason') = 'urgency_decay'
  `) as { count: string }[];
  const urgencyDecays = Number(urgencyRows[0]?.count ?? 0);

  const optInRows = (await sql`
    SELECT
      SUM(CASE WHEN auto_archive_enabled THEN 1 ELSE 0 END)::text AS enabled,
      SUM(CASE WHEN NOT auto_archive_enabled THEN 1 ELSE 0 END)::text AS disabled
    FROM users WHERE deleted_at IS NULL
  `) as { enabled: string; disabled: string }[];
  const optedIn = Number(optInRows[0]?.enabled ?? 0);
  const optedOut = Number(optInRows[0]?.disabled ?? 0);

  // 2. Restores since ramp start (FPs)
  const restoreRows = (await sql`
    SELECT COUNT(*)::text AS count
    FROM inbox_items
    WHERE user_restored_at IS NOT NULL
      AND user_restored_at >= ${RAMP_START}
  `) as { count: string }[];
  const totalRestores = Number(restoreRows[0]?.count ?? 0);

  const fpRate = totalArchives > 0 ? (totalRestores / totalArchives) * 100 : 0;

  console.log(`Wave 5 classifier auto-archives:        ${totalArchives}`);
  console.log(`Urgency-decay archives (not Wave 5):    ${urgencyDecays}`);
  console.log(`User restores (FP signal, ramp window): ${totalRestores}`);
  console.log(`False-positive rate:                    ${fpRate.toFixed(2)}%`);
  console.log(``);
  console.log(`Users with auto_archive_enabled=true:   ${optedIn}`);
  console.log(`Users with auto_archive_enabled=false:  ${optedOut}`);
  console.log(``);

  // 3. Per-day breakdown
  console.log(`--- Daily breakdown ---`);
  const daily = (await sql`
    WITH a AS (
      SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*) AS archives
      FROM audit_log
      WHERE action = 'auto_archive' AND result = 'success' AND created_at >= ${RAMP_START}
      GROUP BY 1
    ),
    r AS (
      SELECT DATE_TRUNC('day', user_restored_at)::date AS day, COUNT(*) AS restores
      FROM inbox_items
      WHERE user_restored_at IS NOT NULL AND user_restored_at >= ${RAMP_START}
      GROUP BY 1
    )
    SELECT
      COALESCE(a.day, r.day)::text AS day,
      COALESCE(a.archives, 0)::text AS archives,
      COALESCE(r.restores, 0)::text AS restores
    FROM a
    FULL OUTER JOIN r ON a.day = r.day
    ORDER BY 1
  `) as { day: string; archives: string; restores: string }[];
  for (const d of daily) {
    const arc = Number(d.archives);
    const res = Number(d.restores);
    const rate = arc > 0 ? ((res / arc) * 100).toFixed(1) : "—";
    console.log(`  ${d.day}  archives=${arc.toString().padStart(4)}  restores=${res.toString().padStart(3)}  fp=${rate}%`);
  }
  console.log(``);

  // 4. Distinct users affected
  const userRows = (await sql`
    SELECT
      (SELECT COUNT(DISTINCT user_id)::text FROM audit_log
        WHERE action = 'auto_archive' AND result = 'success' AND created_at >= ${RAMP_START}) AS archived_users,
      (SELECT COUNT(DISTINCT user_id)::text FROM inbox_items
        WHERE user_restored_at IS NOT NULL AND user_restored_at >= ${RAMP_START}) AS restored_users
  `) as { archived_users: string; restored_users: string }[];
  console.log(`Distinct users with auto-archives:  ${userRows[0]?.archived_users ?? 0}`);
  console.log(`Distinct users with restores:       ${userRows[0]?.restored_users ?? 0}`);
  console.log(``);

  // 5. Top sender domains auto-archived (sanity check the targeting)
  console.log(`--- Top 10 auto-archived sender domains ---`);
  const domains = (await sql`
    SELECT
      (detail->>'senderDomain') AS domain,
      COUNT(*)::text AS n
    FROM audit_log
    WHERE action = 'auto_archive'
      AND result = 'success'
      AND created_at >= ${RAMP_START}
      AND detail->>'senderDomain' IS NOT NULL
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `) as { domain: string; n: string }[];
  for (const d of domains) {
    console.log(`  ${d.n.padStart(4)}  ${d.domain}`);
  }
  console.log(``);

  // 6. Gate evaluation
  console.log(`--- Flip gate evaluation ---`);
  const optInOk = optedIn >= 1;
  const sampleOk = totalArchives >= 50;
  const fpOk = fpRate < 2;
  console.log(`  Opt-in gate (≥1 user enabled): ${optInOk ? "PASS" : "FAIL"} (${optedIn})`);
  console.log(`  Volume gate (≥50 archives):    ${sampleOk ? "PASS" : "FAIL"} (${totalArchives})`);
  console.log(`  FP-rate gate (<2%):            ${fpOk ? "PASS" : "FAIL"} (${fpRate.toFixed(2)}%)`);
  const verdict =
    !optInOk ? "DEFER (no users opted into ramp — field signal impossible)"
    : !sampleOk ? "EXTEND-RAMP (insufficient signal)"
    : !fpOk ? "NO-FLIP (FP rate too high — tighten classifier first)"
    : "FLIP (ramp succeeded)";
  console.log(`  Verdict:                       ${verdict}`);
  console.log(``);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
