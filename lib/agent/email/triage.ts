import "server-only";
import { db } from "@/lib/db/client";
import {
  inboxItems,
  agentRules,
  users,
  type NewInboxItem,
  type InboxItem,
  type SenderRole,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { classifyEmail } from "./rules";
import type { ClassifyInput, TriageResult, UserContext } from "./types";
import { logEmailAudit } from "./audit";

// Public API. `triageMessage` is pure-enough: it reads user context from
// DB but does not write. `applyTriageResult` writes the inbox row and
// emits audit entries. Split so callers can decide per-message whether to
// persist (e.g. future dry-run / testing / bulk replay tooling).

export async function triageMessage(
  userId: string,
  input: ClassifyInput
): Promise<TriageResult> {
  const ctx = await buildUserContext(userId, input.fromDomain);
  return classifyEmail(input, ctx);
}

export async function applyTriageResult(
  userId: string,
  sourceAccountId: string,
  input: ClassifyInput,
  result: TriageResult
): Promise<InboxItem | null> {
  const row: NewInboxItem = {
    userId,
    sourceType: "gmail",
    sourceAccountId,
    externalId: input.externalId,
    threadExternalId: input.threadExternalId,
    senderEmail: input.fromEmail,
    senderName: input.fromName,
    // senderDomain is a generated column — Postgres fills it.
    senderRole: result.senderRole as SenderRole | null,
    recipientTo: input.toEmails,
    recipientCc: input.ccEmails,
    subject: input.subject,
    snippet: input.snippet,
    receivedAt: input.receivedAt,
    bucket: result.bucket,
    ruleProvenance: result.ruleProvenance,
    firstTimeSender: result.firstTimeSender,
    status: result.bucket === "ignore" ? "dismissed" : "open",
  };

  // Idempotent: the (user_id, source_type, external_id) unique constraint
  // short-circuits re-ingests. `returning()` on conflict returns nothing
  // so we can detect a dup cheaply.
  const inserted = await db
    .insert(inboxItems)
    .values(row)
    .onConflictDoNothing({
      target: [
        inboxItems.userId,
        inboxItems.sourceType,
        inboxItems.externalId,
      ],
    })
    .returning();

  const created = inserted[0] ?? null;
  if (created) {
    await logEmailAudit({
      userId,
      action: "email_item_created",
      result: "success",
      resourceId: created.id,
      detail: {
        bucket: result.bucket,
        firstTimeSender: result.firstTimeSender,
        provenanceCount: result.ruleProvenance.length,
      },
    });
  } else {
    await logEmailAudit({
      userId,
      action: "email_item_skipped",
      result: "success",
      resourceId: input.externalId,
      detail: { reason: "duplicate_external_id" },
    });
  }

  return created;
}

// ---------------------------------------------------------------------------
// UserContext assembly
// ---------------------------------------------------------------------------

async function buildUserContext(
  userId: string,
  _senderDomain: string
): Promise<UserContext> {
  const [userRow] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userEmail = userRow?.email ?? "";

  // Pull enabled per-user rules scoped to sender or domain. We only need
  // the `senderRole` + `riskTier` slices for L1.
  const ruleRows = await db
    .select({
      scope: agentRules.scope,
      matchNormalized: agentRules.matchNormalized,
      riskTier: agentRules.riskTier,
      senderRole: agentRules.senderRole,
    })
    .from(agentRules)
    .where(
      and(
        eq(agentRules.userId, userId),
        eq(agentRules.enabled, true),
        isNull(agentRules.deletedAt)
      )
    );

  const learnedDomains: UserContext["learnedDomains"] = new Map();
  const learnedSenders: UserContext["learnedSenders"] = new Map();
  for (const r of ruleRows) {
    if (r.scope === "domain") {
      learnedDomains.set(r.matchNormalized, {
        riskTier: r.riskTier ?? null,
        senderRole: r.senderRole ?? null,
      });
    } else if (r.scope === "sender") {
      learnedSenders.set(r.matchNormalized, {
        riskTier: r.riskTier ?? null,
        senderRole: r.senderRole ?? null,
      });
    }
  }

  const priorDomainRows = await db
    .selectDistinct({ senderDomain: inboxItems.senderDomain })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt)));
  const seenDomains = new Set<string>(
    priorDomainRows.map((r) => r.senderDomain.toLowerCase())
  );

  return {
    userId,
    userEmail,
    learnedDomains,
    learnedSenders,
    seenDomains,
  };
}
