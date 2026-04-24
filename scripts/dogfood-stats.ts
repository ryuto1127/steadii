/**
 * scripts/dogfood-stats.ts
 *
 * Prints a snapshot of W2 agent behavior so Ryuto can assess classification
 * quality, draft coverage, and retrieval depth as real Gmail flows in.
 *
 * Usage:
 *
 *   pnpm db:dogfood-stats
 *
 * Flags:
 *   --user=UUID   Restrict to one user (default: all users in the DB)
 *   --days=N      Only consider items received within N days (default: 7)
 *   --sample=K    Print K most recent draft_reply / high-risk drafts with
 *                 full reasoning (default: 5)
 *
 * Env loading + server-only shim are handled by scripts/_register.cjs.
 */
import { db } from "@/lib/db/client";
import { inboxItems, agentDrafts } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

function parseFlag(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function main() {
  const userFilter = parseFlag("user");
  const days = Number(parseFlag("days", "7"));
  const sample = Number(parseFlag("sample", "5"));

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const userCond = userFilter ? eq(inboxItems.userId, userFilter) : undefined;
  const inboxWhere = and(
    gte(inboxItems.receivedAt, since),
    isNull(inboxItems.deletedAt),
    ...(userCond ? [userCond] : [])
  );

  // --- Inbox bucket distribution -------------------------------------------
  const bucketRows = await db
    .select({
      bucket: inboxItems.bucket,
      count: sql<number>`count(*)::int`,
    })
    .from(inboxItems)
    .where(inboxWhere)
    .groupBy(inboxItems.bucket);

  const totalInbox = bucketRows.reduce((s, r) => s + r.count, 0);
  const l2PendingCount =
    bucketRows.find((r) => r.bucket === "l2_pending")?.count ?? 0;
  const l2Referral = totalInbox > 0 ? (l2PendingCount / totalInbox) * 100 : 0;

  // --- Final risk_tier distribution (post-L2) ------------------------------
  const riskRows = await db
    .select({
      tier: inboxItems.riskTier,
      count: sql<number>`count(*)::int`,
    })
    .from(inboxItems)
    .where(inboxWhere)
    .groupBy(inboxItems.riskTier);

  // --- Agent draft action distribution -------------------------------------
  const draftWhere = userFilter
    ? and(
        gte(agentDrafts.createdAt, since),
        eq(agentDrafts.userId, userFilter)
      )
    : gte(agentDrafts.createdAt, since);

  const actionRows = await db
    .select({
      action: agentDrafts.action,
      count: sql<number>`count(*)::int`,
    })
    .from(agentDrafts)
    .where(draftWhere)
    .groupBy(agentDrafts.action);

  const statusRows = await db
    .select({
      status: agentDrafts.status,
      count: sql<number>`count(*)::int`,
    })
    .from(agentDrafts)
    .where(draftWhere)
    .groupBy(agentDrafts.status);

  // --- Retrieval depth (high-risk only) ------------------------------------
  const retrievalRows = await db
    .select({
      provenance: agentDrafts.retrievalProvenance,
    })
    .from(agentDrafts)
    .where(
      and(
        draftWhere,
        inArray(agentDrafts.riskTier, ["high"])
      )
    );

  const retrievalUsed = retrievalRows.filter(
    (r) => r.provenance && r.provenance.returned > 0
  );
  const avgReturned =
    retrievalUsed.length > 0
      ? retrievalUsed.reduce((s, r) => s + (r.provenance?.returned ?? 0), 0) /
        retrievalUsed.length
      : 0;
  const avgCandidates =
    retrievalUsed.length > 0
      ? retrievalUsed.reduce(
          (s, r) => s + (r.provenance?.total_candidates ?? 0),
          0
        ) / retrievalUsed.length
      : 0;

  // --- Recent draft samples ------------------------------------------------
  const samples = await db
    .select({
      createdAt: agentDrafts.createdAt,
      riskTier: agentDrafts.riskTier,
      action: agentDrafts.action,
      reasoning: agentDrafts.reasoning,
      draftSubject: agentDrafts.draftSubject,
      draftBody: agentDrafts.draftBody,
      status: agentDrafts.status,
      retrievalProvenance: agentDrafts.retrievalProvenance,
    })
    .from(agentDrafts)
    .where(
      and(
        draftWhere,
        inArray(agentDrafts.action, ["draft_reply", "ask_clarifying", "paused"])
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(sample);

  // --- Render --------------------------------------------------------------
  const line = "─".repeat(66);
  const pct = (n: number, d: number) =>
    d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "n/a";

  console.log("");
  console.log(line);
  console.log(
    `  Steadii dogfood stats · last ${days}d${
      userFilter ? ` · user=${userFilter}` : ""
    }`
  );
  console.log(line);

  console.log("\n  Inbox bucket distribution (L1 result)");
  for (const r of bucketRows.sort((a, b) => b.count - a.count)) {
    console.log(
      `    ${(r.bucket ?? "(null)").padEnd(16)} ${String(r.count).padStart(
        5
      )}   ${pct(r.count, totalInbox)}`
    );
  }
  console.log(
    `    ${"total".padEnd(16)} ${String(totalInbox).padStart(5)}   100%`
  );
  console.log(
    `  L2 referral rate: ${l2Referral.toFixed(1)}%  ${
      l2Referral < 20 ? "✓ within memory target (<20%)" : "⚠ above 20% target"
    }`
  );

  console.log("\n  Final risk_tier distribution (post-L2, on inbox_items)");
  for (const r of riskRows.sort((a, b) => b.count - a.count)) {
    console.log(
      `    ${(r.tier ?? "(null)").padEnd(16)} ${String(r.count).padStart(
        5
      )}   ${pct(r.count, totalInbox)}`
    );
  }

  console.log("\n  agent_drafts.action distribution");
  const totalDrafts = actionRows.reduce((s, r) => s + r.count, 0);
  for (const r of actionRows.sort((a, b) => b.count - a.count)) {
    console.log(
      `    ${r.action.padEnd(16)} ${String(r.count).padStart(5)}   ${pct(
        r.count,
        totalDrafts
      )}`
    );
  }

  console.log("\n  agent_drafts.status distribution");
  for (const r of statusRows.sort((a, b) => b.count - a.count)) {
    console.log(
      `    ${r.status.padEnd(16)} ${String(r.count).padStart(5)}   ${pct(
        r.count,
        totalDrafts
      )}`
    );
  }

  console.log("\n  Deep-pass retrieval depth (high-risk only)");
  console.log(`    high-risk drafts: ${retrievalRows.length}`);
  console.log(`    with retrieval:   ${retrievalUsed.length}`);
  if (retrievalUsed.length > 0) {
    console.log(`    avg returned:     ${avgReturned.toFixed(1)}`);
    console.log(`    avg candidates:   ${avgCandidates.toFixed(1)}`);
  }

  if (samples.length > 0) {
    console.log(`\n  Recent ${samples.length} draft/ask/paused samples\n`);
    for (const s of samples) {
      const when = new Date(s.createdAt).toISOString().slice(0, 16).replace("T", " ");
      console.log(
        `  [${when}] ${s.riskTier ?? "?"} · ${s.action} · status=${s.status}${
          s.retrievalProvenance
            ? ` · ${s.retrievalProvenance.returned}/${s.retrievalProvenance.total_candidates} retrieved`
            : ""
        }`
      );
      if (s.reasoning) {
        console.log(
          `    reasoning: ${s.reasoning.slice(0, 220)}${
            s.reasoning.length > 220 ? "…" : ""
          }`
        );
      }
      if (s.draftSubject) {
        console.log(`    subject:   ${s.draftSubject}`);
      }
      if (s.draftBody) {
        const body = s.draftBody.slice(0, 220).replace(/\n/g, " ");
        console.log(`    body:      ${body}${s.draftBody.length > 220 ? "…" : ""}`);
      }
      console.log("");
    }
  }

  console.log(line);
  console.log("  Done. Repeat daily to track trends.");
  console.log(line);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
