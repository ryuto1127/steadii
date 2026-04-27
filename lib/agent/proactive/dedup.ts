import { createHash } from "node:crypto";
import type { AgentProposalIssueType } from "@/lib/db/schema";

// Identity = sha256(issueType + sorted source_record_ids). Per-user unique
// (the unique index on agent_proposals is (user_id, dedup_key)). Keeping
// the algorithm centralized so the resolve / dismiss / re-eligibility
// paths can recompute it.
export function buildDedupKey(
  issueType: AgentProposalIssueType,
  sourceRecordIds: string[]
): string {
  const sorted = [...sourceRecordIds].sort();
  const payload = `${issueType}::${sorted.join("|")}`;
  return createHash("sha256").update(payload).digest("hex");
}
