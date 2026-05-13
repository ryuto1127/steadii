import "server-only";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

// Every email-side write gets an audit_log row. Kept thin so callers can
// fire-and-forget during an ingest loop without spawning extra Promises.
export type EmailAuditAction =
  | "email_ingest_started"
  | "email_ingest_completed"
  | "email_ingest_failed"
  | "email_item_created"
  | "email_item_skipped"
  | "email_rule_applied"
  // W2 additions — surface embed + L2 failures for observability.
  | "email_embed_failed"
  | "email_l2_started"
  | "email_l2_completed"
  | "email_l2_paused"
  | "email_l2_failed"
  // engineer-36 — admin "Regenerate AI drafts" sweep. One row per
  // per-draft refresh attempt (success or failure), so audit + digest
  // surfaces can distinguish a fresh L2 invocation from a regen.
  | "email_l2_regenerated"
  // Phase 7 W1 additions — class binding (run at ingest) and the L2-side
  // multi-source fanout retrieval. The fanout shape is logged separately
  // from email_l2_completed so per-source counts/latencies stay
  // independently filterable in admin dashboards.
  | "email_class_bound"
  | "email_fanout_completed"
  | "email_fanout_timeout"
  // Wave 5 — auto-archive (Tier 1 low-risk silent hide) and the
  // user-driven restore that feeds the learning signal back into
  // agent_rules. Recent activity + Inbox Hidden chip + digest section
  // all read these.
  | "auto_archive"
  | "auto_archive_failed"
  | "auto_archive_restored"
  // engineer-48 — second-pass reranker over fanout's cosine-recall
  // slate. Detail payload carries phase + before/after counts +
  // dropped ids + token cost so the audit log can prove the precision
  // lift.
  | "retrieval_reranked";

export async function logEmailAudit(params: {
  userId: string;
  action: EmailAuditAction;
  result: "success" | "failure";
  resourceId?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(auditLog).values({
    userId: params.userId,
    action: params.action,
    resourceType: "email_inbox",
    resourceId: params.resourceId ?? null,
    toolName: null,
    result: params.result,
    detail: params.detail ?? null,
  });
}
