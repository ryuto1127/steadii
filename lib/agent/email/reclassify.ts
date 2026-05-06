import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  inboxItems,
  type InboxBucket,
  type InboxRiskTier,
  type SenderRole,
} from "@/lib/db/schema";
import { triageMessage } from "./triage";
import type { ClassifyInput } from "./types";
import { logEmailAudit } from "./audit";

// Re-runs L1 over every open inbox_item for a user. Triggered by the
// Settings "Re-classify with latest rules" button — useful when the
// classifier shipped a new rule (engineer-32 GitHub-aware routing,
// engineer-33 OTP urgency, future bot domains) and the user wants
// existing items to pick up the new bucketing instead of being
// frozen at their original classification.
//
// Scope:
//   - status='open', deletedAt IS NULL — operate on the live queue only
//   - Per-row UPDATE of bucket / riskTier / senderRole / firstTimeSender /
//     triageConfidence / urgencyExpiresAt / ruleProvenance
//   - Bucket='ignore' rows flip to status='dismissed' (mirrors
//     applyTriageResult initial-write behavior)
//   - Does NOT touch agent_drafts; legacy drafts on now-low items are
//     orphan but the strict action-needed filter (PR #159) just hides
//     them rather than mutating L2 state. A separate sweep can flip
//     stale drafts to status='superseded' if/when needed.
//   - Audit log entry per row so digest + activity timeline reflect
//     the change.
//
// Performance: at α scale (≤ 200 open items per user) the loop is
// fast — L1 is rule-based, no LLM. For users with thousands of items
// this would need batching; not a concern today.

export type ReclassifyOutcome = {
  scanned: number;
  changed: number;
  ignoredAfter: number;
};

export async function reclassifyAllInboxItems(
  userId: string
): Promise<ReclassifyOutcome> {
  const rows = await db
    .select({
      id: inboxItems.id,
      externalId: inboxItems.externalId,
      threadExternalId: inboxItems.threadExternalId,
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      senderDomain: inboxItems.senderDomain,
      recipientTo: inboxItems.recipientTo,
      recipientCc: inboxItems.recipientCc,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      receivedAt: inboxItems.receivedAt,
      bucket: inboxItems.bucket,
      riskTier: inboxItems.riskTier,
      senderRole: inboxItems.senderRole,
      firstTimeSender: inboxItems.firstTimeSender,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, "open"),
        isNull(inboxItems.deletedAt)
      )
    );

  let changed = 0;
  let ignoredAfter = 0;
  for (const r of rows) {
    const input: ClassifyInput = {
      externalId: r.externalId,
      threadExternalId: r.threadExternalId,
      fromEmail: r.senderEmail,
      fromName: r.senderName,
      fromDomain: r.senderDomain,
      toEmails: r.recipientTo,
      ccEmails: r.recipientCc,
      subject: r.subject,
      snippet: r.snippet,
      // bodySnippet not stored separately — reuse snippet so the L1
      // keyword scan still has body-side text to match against.
      bodySnippet: r.snippet,
      receivedAt: r.receivedAt,
      gmailLabelIds: [],
      listUnsubscribe: null,
      inReplyTo: null,
      headerFromRaw: null,
      autoSubmittedHeader: null,
      precedenceHeader: null,
    };

    let result;
    try {
      result = await triageMessage(userId, input);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "reclassify_all", phase: "triage" },
        user: { id: userId },
        extra: { inboxItemId: r.id },
      });
      continue;
    }

    const before = {
      bucket: r.bucket,
      riskTier: r.riskTier,
      senderRole: r.senderRole,
      firstTimeSender: r.firstTimeSender,
    };
    const after = {
      bucket: result.bucket,
      riskTier: null as InboxRiskTier | null, // L1 doesn't write riskTier; L2 does. Keep existing.
      senderRole: result.senderRole,
      firstTimeSender: result.firstTimeSender,
    };
    const isChanged =
      before.bucket !== (after.bucket as InboxBucket) ||
      before.senderRole !== (after.senderRole as SenderRole | null) ||
      before.firstTimeSender !== after.firstTimeSender;

    if (!isChanged) continue;

    // Newly-classified-ignore rows flip to status='dismissed' so they
    // disappear from the open queue. Otherwise stay 'open'.
    const newStatus =
      result.bucket === "ignore" ? "dismissed" : ("open" as const);
    if (result.bucket === "ignore") ignoredAfter++;

    await db
      .update(inboxItems)
      .set({
        bucket: result.bucket,
        senderRole: result.senderRole,
        firstTimeSender: result.firstTimeSender,
        ruleProvenance: result.ruleProvenance,
        triageConfidence: result.confidence,
        urgencyExpiresAt: result.urgencyExpiresAt,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, r.id));

    await logEmailAudit({
      userId,
      action: "email_rule_applied",
      result: "success",
      resourceId: r.id,
      detail: {
        reason: "reclassify_all",
        before: before.bucket,
        after: after.bucket,
      },
    });

    changed++;
  }

  return { scanned: rows.length, changed, ignoredAfter };
}
