import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems } from "@/lib/db/schema";

// W4 dogfood metrics target (memory project_agent_model.md, 2026-04-21):
// - classification error rate < 5%
// - draft edit rate < 20%
// - post-send regret rate = 0 (non-zero triggers rollback)
//
// What's measurable today vs proxied:
// - Edit rate: `agent_drafts.status='edited'` is a direct positive signal,
//   but it misses "edited then sent" (status flips to sent_pending/sent).
//   Until we add a `was_edited` column we approximate as
//   edited / (drafts with reviewable action). Conservative: real edit
//   rate is at least this number.
// - Dismiss rate: `status='dismissed'`. Stand-in for "agent shouldn't
//   have flagged this" — not perfect but the closest signal we have
//   without a regret button.
// - Send rate: drafts that reached the Gmail API (sent_pending → sent).
//   The complement of dismiss + still-pending stale.
//
// Returns null counts as zero so callers can render without guarding.

export type AgentMetrics = {
  windowDays: number;
  totalInbox: number;
  totalDrafts: number;

  // L1 result counts.
  bucketCounts: Array<{ bucket: string; count: number; pct: number }>;
  l2ReferralPct: number; // l2_pending / total

  // Final risk_tier (post-L2) on inbox_items.
  riskTierCounts: Array<{ tier: string; count: number; pct: number }>;

  // agent_drafts breakdown.
  actionCounts: Array<{ action: string; count: number; pct: number }>;
  statusCounts: Array<{ status: string; count: number; pct: number }>;

  // W4 derived rates — only meaningful over drafts that had a Send /
  // Edit / Dismiss decision available (action ∈ {draft_reply,
  // ask_clarifying}). Pure no_op rows pollute the denominator.
  reviewableDrafts: number;
  editRatePct: number;
  dismissRatePct: number;
  sendRatePct: number;

  // Deep-pass retrieval — only high-risk drafts use the deep pass.
  highRiskDrafts: number;
  highRiskWithRetrieval: number;
  avgRetrievalReturned: number;
  avgRetrievalCandidates: number;

  // Phase 7 W1 — multi-source fanout aggregates. Pulled from
  // agent_drafts.retrieval_provenance.fanoutCounts / fanoutTimings /
  // classBinding. Null on pre-W1 rows so the field counts only rows
  // that actually emit fanout context.
  fanout: {
    draftsWithFanout: number;
    avgPerSource: {
      mistakes: number;
      syllabus: number;
      emails: number;
      calendar: number;
    };
    avgTimingsMs: {
      mistakes: number;
      syllabus: number;
      emails: number;
      calendar: number;
      total: number;
    };
    classBindingMethodCounts: Array<{ method: string; count: number; pct: number }>;
    boundDrafts: number;
    unboundDrafts: number;
  };
};

const REVIEWABLE_ACTIONS = ["draft_reply", "ask_clarifying"] as const;
const SENT_STATUSES = ["sent", "sent_pending", "approved"] as const;

export async function computeAgentMetrics(
  options: { userId?: string; days?: number } = {}
): Promise<AgentMetrics> {
  const days = options.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const userInboxCond = options.userId
    ? eq(inboxItems.userId, options.userId)
    : undefined;
  const inboxWhere = and(
    gte(inboxItems.receivedAt, since),
    isNull(inboxItems.deletedAt),
    ...(userInboxCond ? [userInboxCond] : [])
  );

  const userDraftCond = options.userId
    ? eq(agentDrafts.userId, options.userId)
    : undefined;
  const draftWhere = and(
    gte(agentDrafts.createdAt, since),
    ...(userDraftCond ? [userDraftCond] : [])
  );

  const [
    bucketRows,
    riskRows,
    actionRows,
    statusRows,
    reviewableTotalRow,
    reviewableEditedRow,
    reviewableDismissedRow,
    reviewableSentRow,
    retrievalRows,
    allProvenanceRows,
  ] = await Promise.all([
    db
      .select({
        bucket: inboxItems.bucket,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItems)
      .where(inboxWhere)
      .groupBy(inboxItems.bucket),
    db
      .select({
        tier: inboxItems.riskTier,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItems)
      .where(inboxWhere)
      .groupBy(inboxItems.riskTier),
    db
      .select({
        action: agentDrafts.action,
        count: sql<number>`count(*)::int`,
      })
      .from(agentDrafts)
      .where(draftWhere)
      .groupBy(agentDrafts.action),
    db
      .select({
        status: agentDrafts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(agentDrafts)
      .where(draftWhere)
      .groupBy(agentDrafts.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDrafts)
      .where(
        and(draftWhere, inArray(agentDrafts.action, [...REVIEWABLE_ACTIONS]))
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDrafts)
      .where(
        and(
          draftWhere,
          inArray(agentDrafts.action, [...REVIEWABLE_ACTIONS]),
          eq(agentDrafts.status, "edited")
        )
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDrafts)
      .where(
        and(
          draftWhere,
          inArray(agentDrafts.action, [...REVIEWABLE_ACTIONS]),
          eq(agentDrafts.status, "dismissed")
        )
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDrafts)
      .where(
        and(
          draftWhere,
          inArray(agentDrafts.action, [...REVIEWABLE_ACTIONS]),
          inArray(agentDrafts.status, [...SENT_STATUSES])
        )
      ),
    db
      .select({ provenance: agentDrafts.retrievalProvenance })
      .from(agentDrafts)
      .where(and(draftWhere, eq(agentDrafts.riskTier, "high"))),
    db
      .select({ provenance: agentDrafts.retrievalProvenance })
      .from(agentDrafts)
      .where(draftWhere),
  ]);

  const totalInbox = bucketRows.reduce((s, r) => s + r.count, 0);
  const totalDrafts = actionRows.reduce((s, r) => s + r.count, 0);

  const l2Pending =
    bucketRows.find((r) => r.bucket === "l2_pending")?.count ?? 0;
  const l2ReferralPct = totalInbox > 0 ? (l2Pending / totalInbox) * 100 : 0;

  const reviewable = reviewableTotalRow[0]?.n ?? 0;
  const edited = reviewableEditedRow[0]?.n ?? 0;
  const dismissed = reviewableDismissedRow[0]?.n ?? 0;
  const sent = reviewableSentRow[0]?.n ?? 0;
  const editRatePct = reviewable > 0 ? (edited / reviewable) * 100 : 0;
  const dismissRatePct = reviewable > 0 ? (dismissed / reviewable) * 100 : 0;
  const sendRatePct = reviewable > 0 ? (sent / reviewable) * 100 : 0;

  const retrievalUsed = retrievalRows.filter(
    (r) => r.provenance && r.provenance.returned > 0
  );
  const avgRetrievalReturned =
    retrievalUsed.length > 0
      ? retrievalUsed.reduce(
          (s, r) => s + (r.provenance?.returned ?? 0),
          0
        ) / retrievalUsed.length
      : 0;
  const avgRetrievalCandidates =
    retrievalUsed.length > 0
      ? retrievalUsed.reduce(
          (s, r) => s + (r.provenance?.total_candidates ?? 0),
          0
        ) / retrievalUsed.length
      : 0;

  const withPct = <T extends { count: number }>(
    rows: T[],
    total: number
  ): Array<T & { pct: number }> =>
    rows.map((r) => ({
      ...r,
      pct: total > 0 ? (r.count / total) * 100 : 0,
    }));

  // Phase 7 W1 — fanout aggregates. Pre-W1 rows have no fanoutCounts /
  // fanoutTimings / classBinding so they're filtered out of the
  // averages but still surface in the binding-method counts as
  // "(legacy)".
  const fanoutRows = allProvenanceRows.filter(
    (r) => r.provenance && r.provenance.fanoutCounts
  );
  const draftsWithFanout = fanoutRows.length;
  // engineer-38 — `mistakes` was renamed to `senderHistory`. Track both;
  // pre-rename rows still emit `mistakes` so we tally each independently
  // and fall back when one is missing.
  const sumPerSource = {
    mistakes: 0,
    senderHistory: 0,
    syllabus: 0,
    emails: 0,
    calendar: 0,
  };
  const sumTimings = {
    mistakes: 0,
    senderHistory: 0,
    syllabus: 0,
    emails: 0,
    calendar: 0,
    total: 0,
  };
  const methodTallies = new Map<string, number>();
  let bound = 0;
  let unbound = 0;
  for (const r of fanoutRows) {
    const c = r.provenance?.fanoutCounts ?? null;
    if (c) {
      sumPerSource.mistakes += c.mistakes ?? 0;
      sumPerSource.senderHistory += c.senderHistory ?? 0;
      sumPerSource.syllabus += c.syllabus;
      sumPerSource.emails += c.emails;
      sumPerSource.calendar += c.calendar;
    }
    const t = r.provenance?.fanoutTimings ?? null;
    if (t) {
      sumTimings.mistakes += t.mistakes ?? 0;
      sumTimings.senderHistory += t.senderHistory ?? 0;
      sumTimings.syllabus += t.syllabus;
      sumTimings.emails += t.emails;
      sumTimings.calendar += t.calendar;
      sumTimings.total += t.total;
    }
    const b = r.provenance?.classBinding ?? null;
    if (b) {
      methodTallies.set(b.method, (methodTallies.get(b.method) ?? 0) + 1);
      if (b.classId) bound += 1;
      else unbound += 1;
    }
  }
  const denom = Math.max(draftsWithFanout, 1);
  // engineer-38 — `mistakes` field still emitted for legacy dashboards;
  // it now tracks rows persisted before the senderHistory rename.
  // `senderHistory` is the active source for new rows.
  const avgPerSource = {
    mistakes: sumPerSource.mistakes / denom,
    senderHistory: sumPerSource.senderHistory / denom,
    syllabus: sumPerSource.syllabus / denom,
    emails: sumPerSource.emails / denom,
    calendar: sumPerSource.calendar / denom,
  };
  const avgTimingsMs = {
    mistakes: sumTimings.mistakes / denom,
    senderHistory: sumTimings.senderHistory / denom,
    syllabus: sumTimings.syllabus / denom,
    emails: sumTimings.emails / denom,
    calendar: sumTimings.calendar / denom,
    total: sumTimings.total / denom,
  };
  const totalMethods = Array.from(methodTallies.values()).reduce(
    (s, n) => s + n,
    0
  );
  const classBindingMethodCounts = Array.from(methodTallies.entries())
    .map(([method, count]) => ({
      method,
      count,
      pct: totalMethods > 0 ? (count / totalMethods) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    windowDays: days,
    totalInbox,
    totalDrafts,
    bucketCounts: withPct(
      bucketRows
        .map((r) => ({ bucket: r.bucket ?? "(null)", count: r.count }))
        .sort((a, b) => b.count - a.count),
      totalInbox
    ),
    l2ReferralPct,
    riskTierCounts: withPct(
      riskRows
        .map((r) => ({ tier: r.tier ?? "(null)", count: r.count }))
        .sort((a, b) => b.count - a.count),
      totalInbox
    ),
    actionCounts: withPct(
      actionRows
        .map((r) => ({ action: r.action, count: r.count }))
        .sort((a, b) => b.count - a.count),
      totalDrafts
    ),
    statusCounts: withPct(
      statusRows
        .map((r) => ({ status: r.status, count: r.count }))
        .sort((a, b) => b.count - a.count),
      totalDrafts
    ),
    reviewableDrafts: reviewable,
    editRatePct,
    dismissRatePct,
    sendRatePct,
    highRiskDrafts: retrievalRows.length,
    highRiskWithRetrieval: retrievalUsed.length,
    avgRetrievalReturned,
    avgRetrievalCandidates,
    fanout: {
      draftsWithFanout,
      avgPerSource,
      avgTimingsMs,
      classBindingMethodCounts,
      boundDrafts: bound,
      unboundDrafts: unbound,
    },
  };
}
