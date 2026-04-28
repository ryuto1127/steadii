import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import {
  agentEvents,
  agentProposals,
  type AgentEventSource,
  type NewAgentProposalRow,
} from "@/lib/db/schema";
import { buildUserSnapshot } from "./snapshot";
import { ALL_RULES } from "./rules";
import { buildDedupKey } from "./dedup";
import {
  generateProposalActions,
  shouldGenerateActionsFor,
} from "./proposal-generator";
import type { DetectedIssue } from "./types";

// 5-minute per-user debounce. Two scans within the window short-circuit
// to a no-op so rapid sequential edits (e.g., user drags a calendar
// event then re-times it) collapse into one detection pass.
const DEBOUNCE_MINUTES = 5;

// Anything 'running' for longer than this is presumed to be from a
// crashed worker. Cleared to 'error' so the next caller can claim.
const STALE_CLAIM_MINUTES = 10;

// 7-day TTL on pending proposals — prevents stale "Steadii noticed" rows
// from cluttering the inbox after the underlying issue has lost
// relevance. The cron `cron.daily` trigger refreshes anything still
// applicable.
const PROPOSAL_TTL_DAYS = 7;

export type ScanTrigger =
  | { source: AgentEventSource; recordId?: string | null }
  | { source: "cron.daily" };

export type ScanResult = {
  ran: boolean;
  reason?: "debounced" | "concurrent";
  proposalsCreated: number;
  proposalsSkippedByDedup: number;
};

// Public entry. Called by every write hook + the daily cron. Coordinates
// across serverless instances via the `agent_events_running_per_user_idx`
// partial unique index — at most one running claim per user, so two
// near-simultaneous events can't trigger two parallel scans (which would
// otherwise burn duplicate LLM credits even though `agent_proposals`
// dedup catches the row-level duplication).
export async function runScanner(
  userId: string,
  trigger: ScanTrigger
): Promise<ScanResult> {
  // 1. Clear any stale 'running' claim from a crashed worker. Done
  //    before the recency check so a stuck row doesn't masquerade as a
  //    live scanner and starve out new triggers.
  await sweepStaleRunningClaims(userId);

  // 2. 5-minute debounce. The cron trigger bypasses — its job is exactly
  //    to be the catch-all when nothing else has fired today.
  if (trigger.source !== "cron.daily") {
    const recent = await findRecentCompletedScan(userId, DEBOUNCE_MINUTES);
    if (recent) {
      return {
        ran: false,
        reason: "debounced",
        proposalsCreated: 0,
        proposalsSkippedByDedup: 0,
      };
    }
  }

  // 3. Try to claim the running slot. The partial unique index on
  //    (user_id) WHERE status='running' enforces mutual exclusion across
  //    serverless instances. A losing concurrent caller sees no row
  //    returned and exits without scanning.
  const claim = await claimRunningEvent(userId, trigger);
  if (!claim) {
    return {
      ran: false,
      reason: "concurrent",
      proposalsCreated: 0,
      proposalsSkippedByDedup: 0,
    };
  }

  let proposalsCreated = 0;
  let proposalsSkippedByDedup = 0;

  try {
    const snapshot = await buildUserSnapshot(userId);
    const issues: DetectedIssue[] = [];
    for (const rule of ALL_RULES) {
      try {
        issues.push(...rule.detect(snapshot));
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            module: "proactive_scanner",
            rule: rule.name,
            userId,
          },
        });
      }
    }

    for (const issue of issues) {
      const result = await persistProposal(userId, claim.id, issue);
      if (result === "created") proposalsCreated++;
      else if (result === "skipped") proposalsSkippedByDedup++;
    }

    await db
      .update(agentEvents)
      .set({
        status: proposalsCreated > 0 ? "analyzed" : "no_issue",
        analyzedAt: new Date(),
      })
      .where(eq(agentEvents.id, claim.id));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: "proactive_scanner", userId },
    });
    await db
      .update(agentEvents)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        analyzedAt: new Date(),
      })
      .where(eq(agentEvents.id, claim.id));
    throw err;
  }

  return {
    ran: true,
    proposalsCreated,
    proposalsSkippedByDedup,
  };
}

// Flip every 'running' row for this user that's older than the stale
// threshold to 'error'. Idempotent — repeated calls are no-ops once the
// rows are cleared. Scoped to a single user so we don't pay a full-table
// scan on every trigger.
async function sweepStaleRunningClaims(userId: string): Promise<void> {
  const staleFloor = new Date(
    Date.now() - STALE_CLAIM_MINUTES * 60 * 1000
  );
  await db
    .update(agentEvents)
    .set({
      status: "error",
      errorMessage: "stale running claim — presumed worker crash",
      analyzedAt: new Date(),
    })
    .where(
      and(
        eq(agentEvents.userId, userId),
        eq(agentEvents.status, "running"),
        lt(agentEvents.createdAt, staleFloor)
      )
    );
}

// Returns true if any 'analyzed' or 'no_issue' row was completed for
// this user within the last `withinMinutes` minutes. Used as the
// debounce check — if a scan just ran, skip the new one.
async function findRecentCompletedScan(
  userId: string,
  withinMinutes: number
): Promise<boolean> {
  const floor = new Date(Date.now() - withinMinutes * 60 * 1000);
  const rows = await db
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.userId, userId),
        sql`${agentEvents.status} IN ('analyzed', 'no_issue')`,
        gte(agentEvents.analyzedAt, floor)
      )
    )
    .limit(1);
  return rows.length > 0;
}

// Insert a row with status='running'. Returns `{ id }` on success, or
// `null` if the partial unique index (one running claim per user)
// rejected the insert — meaning another instance already holds the
// claim. Callers must treat null as "another scan is in progress, skip".
async function claimRunningEvent(
  userId: string,
  trigger: ScanTrigger
): Promise<{ id: string } | null> {
  const inserted = await db
    .insert(agentEvents)
    .values({
      userId,
      source: trigger.source,
      sourceRecordId:
        "recordId" in trigger ? (trigger.recordId ?? null) : null,
      status: "running",
    })
    .onConflictDoNothing()
    .returning({ id: agentEvents.id });
  return inserted[0] ?? null;
}

// Insert one proposal. Returns "created" if the row was inserted, or
// "skipped" if the dedup index prevented it (an identical pending /
// resolved row already exists). The LLM proposal generator runs only
// on first-time detections — if the unique index would reject the
// insert, we skip the LLM call entirely to honor the D7 cost budget.
async function persistProposal(
  userId: string,
  triggerEventId: string,
  issue: DetectedIssue
): Promise<"created" | "skipped"> {
  const dedupKey = buildDedupKey(issue.issueType, issue.sourceRecordIds);
  const expiresAt = new Date(
    Date.now() + PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  let actionOptions = issue.baselineActions ?? [
    {
      key: "dismiss",
      label: "Dismiss",
      description: "Hide this notice for 24 hours.",
      tool: "dismiss" as const,
      payload: {},
    },
  ];

  if (shouldGenerateActionsFor(issue.issueType)) {
    try {
      const result = await generateProposalActions({ userId, issue });
      if (result.actions.length > 0) {
        actionOptions = result.actions;
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          module: "proactive_scanner",
          phase: "generate_actions",
          issueType: issue.issueType,
        },
      });
      // Fall through: keep the baseline / dismiss-only menu.
    }
  }

  const row: NewAgentProposalRow = {
    userId,
    triggerEventId,
    issueType: issue.issueType,
    issueSummary: issue.issueSummary,
    reasoning: issue.reasoning,
    sourceRefs: issue.sourceRefs,
    actionOptions,
    dedupKey,
    expiresAt,
  };

  // ON CONFLICT (user_id, dedup_key) DO NOTHING — the scanner relies on
  // the dismiss endpoint to set status='dismissed' AND to clear the row
  // after the 24h re-eligibility window. While a prior pending /
  // dismissed / resolved row exists with the same dedup_key, identical
  // re-detections collapse here.
  const inserted = await db
    .insert(agentProposals)
    .values(row)
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    })
    .returning({ id: agentProposals.id });

  return inserted.length > 0 ? "created" : "skipped";
}

// Convenience wrapper for write-hook call sites. Fires-and-forgets so
// mutations don't pay the scanner's latency. Errors land in Sentry but
// never propagate to the caller.
export function triggerScanInBackground(
  userId: string,
  trigger: ScanTrigger
): void {
  runScanner(userId, trigger).catch((err) => {
    Sentry.captureException(err, {
      tags: { module: "proactive_scanner", phase: "background", userId },
    });
  });
}

// Re-exported for cron + write-hook callers that prefer a typed source
// constant over a magic string.
export { type AgentEventSource };
