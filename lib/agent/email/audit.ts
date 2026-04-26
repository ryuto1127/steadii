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
  // Phase 7 W1 additions — class binding (run at ingest) and the L2-side
  // multi-source fanout retrieval. The fanout shape is logged separately
  // from email_l2_completed so per-source counts/latencies stay
  // independently filterable in admin dashboards.
  | "email_class_bound"
  | "email_fanout_completed"
  | "email_fanout_timeout";

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
