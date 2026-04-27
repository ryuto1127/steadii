import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import {
  agentEvents,
  agentProposals,
  type AgentEventSource,
  type NewAgentEventRow,
  type NewAgentProposalRow,
} from "@/lib/db/schema";
import { buildUserSnapshot } from "./snapshot";
import { ALL_RULES } from "./rules";
import { buildDedupKey } from "./dedup";
import type { DetectedIssue } from "./types";

// 5-minute per-user debounce. Two scans within the window short-circuit
// to a no-op so rapid sequential edits (e.g., user drags a calendar
// event then re-times it) collapse into one detection pass.
const DEBOUNCE_MINUTES = 5;

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
  reason?: "debounced";
  proposalsCreated: number;
  proposalsSkippedByDedup: number;
};

// Public entry. Called by every write hook + the daily cron. Inserts the
// triggering `agent_event` row, runs the full snapshot + ruleset, and
// upserts any new proposals. Idempotent — repeated calls within
// DEBOUNCE_MINUTES are no-ops; outside that window, dedup at the row
// level keeps duplicate proposals from accumulating.
export async function runScanner(
  userId: string,
  trigger: ScanTrigger
): Promise<ScanResult> {
  // Insert the event row first so the audit trail exists even if the
  // scan itself fails. status='pending' until the rules complete.
  const eventRow: NewAgentEventRow = {
    userId,
    source: trigger.source,
    sourceRecordId:
      "recordId" in trigger ? (trigger.recordId ?? null) : null,
  };
  const [insertedEvent] = await db
    .insert(agentEvents)
    .values(eventRow)
    .returning({ id: agentEvents.id });

  // Per-user debounce: if any other agent_events row was analyzed within
  // the last DEBOUNCE_MINUTES, skip the analysis and rely on the prior
  // scan + the daily cron.
  const debounceFloor = new Date(
    Date.now() - DEBOUNCE_MINUTES * 60 * 1000
  );
  const recent = await db
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.userId, userId),
        eq(agentEvents.status, "analyzed"),
        gte(agentEvents.analyzedAt, debounceFloor)
      )
    )
    .limit(1);

  // The cron trigger bypasses debounce: its job is exactly to be the
  // catch-all when nothing else has fired today.
  if (recent.length > 0 && trigger.source !== "cron.daily") {
    await db
      .update(agentEvents)
      .set({ status: "no_issue", analyzedAt: new Date() })
      .where(eq(agentEvents.id, insertedEvent.id));
    return {
      ran: false,
      reason: "debounced",
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
      const result = await persistProposal(
        userId,
        insertedEvent.id,
        issue
      );
      if (result === "created") proposalsCreated++;
      else if (result === "skipped") proposalsSkippedByDedup++;
    }

    await db
      .update(agentEvents)
      .set({
        status: proposalsCreated > 0 ? "analyzed" : "no_issue",
        analyzedAt: new Date(),
      })
      .where(eq(agentEvents.id, insertedEvent.id));
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
      .where(eq(agentEvents.id, insertedEvent.id));
    throw err;
  }

  return {
    ran: true,
    proposalsCreated,
    proposalsSkippedByDedup,
  };
}

// Insert one proposal. Returns "created" if the row was inserted, or
// "skipped" if the dedup index prevented it (an identical pending /
// resolved row already exists). PR 2 will plug in the LLM-driven
// `actionOptions[]`; for now we use the rule's baseline actions or a
// minimal `dismiss`-only menu so the row is still useful.
async function persistProposal(
  userId: string,
  triggerEventId: string,
  issue: DetectedIssue
): Promise<"created" | "skipped"> {
  const dedupKey = buildDedupKey(issue.issueType, issue.sourceRecordIds);
  const expiresAt = new Date(
    Date.now() + PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  const actionOptions = issue.baselineActions ?? [
    {
      key: "dismiss",
      label: "Dismiss",
      description: "Hide this notice for 24 hours.",
      tool: "dismiss",
      payload: {},
    },
  ];

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
