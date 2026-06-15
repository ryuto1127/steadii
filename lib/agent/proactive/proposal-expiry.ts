import "server-only";

// 2026-06-13 — Wave A noise reduction. `agent_proposals.expires_at` is
// stamped (now + 7d) at insert time but, until now, was read by NO sweep:
// expired proposals sat in the queue forever. This sub-sweep activates
// that column.
//
// A single bounded partial-index UPDATE flips 'pending' rows whose
// expires_at has elapsed to 'expired'. No Gmail / LLM / per-row loop —
// the queue read path (fetchPendingProposals) filters on status='pending',
// so an 'expired' row leaves the queue silently. The Gmail message (if
// any) is untouched.
//
// NOTE: the first production run flips a backlog of long-expired rows in
// one shot — a one-time visible queue drop. That's the intended behavior
// (those proposals were already past their 7d window).
//
// Rows with a NULL expires_at (legacy proposals stamped before the
// column was populated) are NOT touched — `expires_at < now` is false
// for NULL in SQL, so they stay 'pending' and rely on the user / other
// resolution paths. This is intentional: we only retire rows that carry
// an explicit expiry.

import { and, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { agentProposals } from "@/lib/db/schema";

export type ProposalExpirySweepResult = {
  expired: number;
};

export async function runProposalExpirySweep(args: {
  // ms epoch for "now" — pass Date.now() in production, a fixed value
  // in tests for determinism.
  nowMs: number;
}): Promise<ProposalExpirySweepResult> {
  const now = new Date(args.nowMs);

  // Single bounded UPDATE. The agent_proposals_user_pending_idx partial
  // path keeps the candidate set tight (status='pending'); the
  // expires_at comparison prunes the rest. `.returning` only the id so
  // the row payloads don't cross the wire — we just need the count.
  const updated = await db
    .update(agentProposals)
    .set({ status: "expired" })
    .where(
      and(
        eq(agentProposals.status, "pending"),
        isNotNull(agentProposals.expiresAt),
        lt(agentProposals.expiresAt, now),
      ),
    )
    .returning({ id: agentProposals.id });

  return { expired: updated.length };
}
