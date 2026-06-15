// 2026-06-13 — Unified importance floor for FYI (notify_only) drafts.
//
// ONE floor across both surfaces that show pending drafts:
//   - the EMAIL digest (lib/digest/build.ts), and
//   - the in-app judgment queue (lib/agent/queue/build.ts fetchPendingDrafts).
//
// Previously the floor lived only in the digest module, so a LOW-risk
// notify_only FYI was hidden from the email but still surfaced as a queue
// card — exactly the noise the floor was meant to suppress. This leaf
// module is the single source of truth so the two surfaces can't drift
// (see knowledge-learnings#mirror-lists-always-drift). It is dependency-
// free (no db / server-only) so both call sites can import it without an
// import cycle.
//
// Rule: notify_only drafts are informational ("no action needed"); a
// LOW-risk FYI is pure noise. draft_reply / ask_clarifying always pass
// (they need a user decision); notify_only passes only at high/medium
// risk. Low-risk notify_only does NOT enter either surface — it still
// exists in the DB for the digest's hidden-count / audit log.

import type { AgentDraftAction, InboxRiskTier } from "@/lib/db/schema";

export function passesImportanceFloor(row: {
  action: AgentDraftAction;
  riskTier: InboxRiskTier;
}): boolean {
  if (row.action !== "notify_only") return true;
  return row.riskTier === "high" || row.riskTier === "medium";
}
