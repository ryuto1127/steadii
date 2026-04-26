import "server-only";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import {
  inboxItems,
  agentRules,
  emailEmbeddings,
  users,
  type NewInboxItem,
  type InboxItem,
  type SenderRole,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { classifyEmail } from "./rules";
import type { ClassifyInput, TriageResult, UserContext } from "./types";
import { logEmailAudit } from "./audit";
import { embedAndStoreInboxItem } from "./embeddings";
import { bindEmailToClass, persistBinding } from "./class-binding";

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

    // Embed synchronously on ingest so the retrieval corpus grows with every
    // triaged item, including bucket='ignore' rows — cost is negligible
    // (~$0.00001 per email at text-embedding-3-small pricing) and it lets
    // future "what did we dismiss?" queries succeed. Failures don't block
    // the ingest — they're logged and retried by the backfill script.
    let embedding: number[] | null = null;
    try {
      await embedAndStoreInboxItem({
        userId,
        inboxItemId: created.id,
        subject: input.subject,
        body: input.bodySnippet ?? input.snippet,
      });
      // Re-read the embedding row so we can pass it to class-binding
      // without a fresh API call (the writer above doesn't return the
      // vector). One-row PK probe; cheap.
      const [row] = await db
        .select({ embedding: emailEmbeddings.embedding })
        .from(emailEmbeddings)
        .where(eq(emailEmbeddings.inboxItemId, created.id))
        .limit(1);
      embedding = row?.embedding ?? null;
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_embed", phase: "on_ingest" },
        user: { id: userId },
      });
      await logEmailAudit({
        userId,
        action: "email_embed_failed",
        result: "failure",
        resourceId: created.id,
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
    }

    // Phase 7 W1 — class binding cache. Run once at ingest so the L2
    // fanout retriever only does an index probe. Fail-soft: on error,
    // leave the row unbound and the fanout falls back to vector-only.
    try {
      const binding = await bindEmailToClass({
        userId,
        subject: input.subject,
        bodySnippet: input.bodySnippet ?? input.snippet,
        senderEmail: input.fromEmail,
        senderName: input.fromName,
        senderRole: result.senderRole as SenderRole | null,
        queryEmbedding: embedding,
      });
      await persistBinding(created.id, binding);
      await logEmailAudit({
        userId,
        action: "email_class_bound",
        result: "success",
        resourceId: created.id,
        detail: {
          classId: binding.classId,
          method: binding.method,
          confidence: binding.confidence,
          alternates: binding.alternates.length,
        },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_class_binding", phase: "on_ingest" },
        user: { id: userId },
      });
    }
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
