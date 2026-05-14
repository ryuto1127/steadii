import "server-only";
import {
  domainOfEmail,
  getHeader,
  getMessage,
  listRecentMessages,
  parseAddress,
  parseAddressList,
} from "@/lib/integrations/google/gmail-fetch";
import {
  GmailNotConnectedError,
  getGoogleProviderAccountId,
  isInvalidGrantError,
  markGmailTokenRevoked,
} from "@/lib/integrations/google/gmail";
import * as Sentry from "@sentry/nextjs";
import { applyTriageResult, triageMessage } from "./triage";
import { logEmailAudit } from "./audit";
import { processL2 } from "./l2";
import { resolveEntitiesInBackground } from "@/lib/agent/entity-graph/resolver";
import type { ClassifyInput } from "./types";

export type IngestSummary = {
  scanned: number;
  created: number;
  skipped: number;
  bucketCounts: Record<string, number>;
  durationMs: number;
};

// Pulls the last 24h of Gmail for the user, runs each message through
// L1 triage, and writes the inbox rows. Idempotent: safe to re-run
// because inbox_items has UNIQUE (user_id, source_type, external_id).
// Errors from Gmail (not-connected, revoked scope) are swallowed and
// logged, because this runs on the post-onboarding redirect path and
// must never block the user from reaching /app.
export async function ingestLast24h(
  userId: string
): Promise<IngestSummary> {
  const startedAt = Date.now();
  await logEmailAudit({
    userId,
    action: "email_ingest_started",
    result: "success",
    detail: { window: "last_24h" },
  });

  const sinceUnix = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

  let providerAccountId: string | null = null;
  try {
    providerAccountId = await getGoogleProviderAccountId(userId);
  } catch {
    providerAccountId = null;
  }
  if (!providerAccountId) {
    await logEmailAudit({
      userId,
      action: "email_ingest_failed",
      result: "failure",
      detail: { reason: "no_google_account" },
    });
    return emptySummary(Date.now() - startedAt);
  }

  let hits: Awaited<ReturnType<typeof listRecentMessages>> = [];
  try {
    hits = await listRecentMessages(userId, sinceUnix);
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      await logEmailAudit({
        userId,
        action: "email_ingest_failed",
        result: "failure",
        detail: { reason: "gmail_not_connected" },
      });
      return emptySummary(Date.now() - startedAt);
    }
    // Wave 5 — invalid_grant means the user's refresh token was
    // rejected (revoked access, password reset, etc). Stamp the user
    // so the layout banner offers a clear re-connect path instead of
    // the silent retry loop the old code path landed in.
    if (isInvalidGrantError(err)) {
      await markGmailTokenRevoked(userId);
      await logEmailAudit({
        userId,
        action: "email_ingest_failed",
        result: "failure",
        detail: { reason: "invalid_grant", message: errorMessage(err) },
      });
      return emptySummary(Date.now() - startedAt);
    }
    await logEmailAudit({
      userId,
      action: "email_ingest_failed",
      result: "failure",
      detail: { reason: "list_failed", message: errorMessage(err) },
    });
    return emptySummary(Date.now() - startedAt);
  }

  let created = 0;
  let skipped = 0;
  const bucketCounts: Record<string, number> = {};

  for (const hit of hits) {
    try {
      const msg = await getMessage(userId, hit.id);
      const input = normalizeMessage(msg);
      if (!input) {
        skipped++;
        continue;
      }
      const result = await triageMessage(userId, input);
      bucketCounts[result.bucket] = (bucketCounts[result.bucket] ?? 0) + 1;
      const row = await applyTriageResult(
        userId,
        providerAccountId,
        input,
        result
      );
      if (row) {
        created++;
        // engineer-51 — kick off entity-graph resolution alongside the
        // L2 pipeline. Fire-and-forget so a slow LLM extract doesn't
        // hold up the ingest loop. The combined subject + body is the
        // input text; senderEmail is passed as known context so
        // person-kind entities are created with primary_email pre-set.
        //
        // engineer-59 — skip on auto_low. Newsletters / transactional /
        // no-reply rows are auto-archived (Wave 5) and don't need an
        // entity-graph entry — the entity extractor is an LLM call
        // (taskType=tool_call) that earns nothing on noise rows. Audit
        // 2026-05-13 showed email-pipeline at 89% of 30d spend; this
        // gating + the embed gate in triage.ts cut the largest UNGATED
        // path the ingest has.
        if (result.bucket !== "auto_low") {
          resolveEntitiesInBackground({
            userId,
            sourceKind: "inbox_item",
            sourceId: row.id,
            contentText: [
              input.subject ?? "",
              input.bodySnippet ?? input.snippet ?? "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            knownContext: {
              senderEmail: input.fromEmail,
              sourceHint: "inbound email",
            },
          });
        }
        // Synchronously run the L2 pipeline for ambiguous (l2_pending) and
        // strict-tier (auto_high / auto_medium) messages. auto_high and
        // auto_medium items skip the risk pass — the L1 rule is strict per
        // memory, so we pass the corresponding forceTier and go straight to
        // the tier-appropriate downstream step (deep+draft for high, direct
        // draft for medium). Without this the Inbox UI can't deep-link
        // those rows (no agent_draft exists to link to).
        //
        // α volume is ≤20 such items per user per 24h — queue is post-α.
        // Failures are isolated per item so one bad message doesn't
        // poison the ingest.
        if (
          result.bucket === "l2_pending" ||
          result.bucket === "auto_high" ||
          result.bucket === "auto_medium"
        ) {
          try {
            await processL2(
              row.id,
              result.bucket === "auto_high"
                ? { forceTier: "high" }
                : result.bucket === "auto_medium"
                ? { forceTier: "medium" }
                : {}
            );
          } catch (err) {
            Sentry.captureException(err, {
              tags: { feature: "email_l2", phase: "ingest" },
              user: { id: userId },
            });
          }
        }
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      await logEmailAudit({
        userId,
        action: "email_ingest_failed",
        result: "failure",
        resourceId: hit.id,
        detail: { reason: "per_message", message: errorMessage(err) },
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  await logEmailAudit({
    userId,
    action: "email_ingest_completed",
    result: "success",
    detail: {
      scanned: hits.length,
      created,
      skipped,
      bucketCounts,
      durationMs,
    },
  });

  if (durationMs > 10_000) {
    console.warn(
      `[email-ingest] ingestLast24h for ${userId} took ${durationMs}ms (scanned=${hits.length})`
    );
  }

  return {
    scanned: hits.length,
    created,
    skipped,
    bucketCounts,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Message → ClassifyInput normalization
// ---------------------------------------------------------------------------

function normalizeMessage(
  msg: Awaited<ReturnType<typeof getMessage>>
): ClassifyInput | null {
  if (!msg.id) return null;
  const headerFromRaw = getHeader(msg, "From");
  const from = parseAddress(headerFromRaw);
  if (!from.email) return null;

  const to = parseAddressList(getHeader(msg, "To"));
  const cc = parseAddressList(getHeader(msg, "Cc"));
  const subject = getHeader(msg, "Subject");
  const dateHeader = getHeader(msg, "Date");
  const internalMs = Number(msg.internalDate ?? NaN);
  const receivedAt =
    Number.isFinite(internalMs) && internalMs > 0
      ? new Date(internalMs)
      : dateHeader
      ? new Date(dateHeader)
      : new Date();

  return {
    externalId: msg.id,
    threadExternalId: msg.threadId ?? null,
    fromEmail: from.email,
    fromName: from.name,
    fromDomain: domainOfEmail(from.email),
    toEmails: to.map((a) => a.email),
    ccEmails: cc.map((a) => a.email),
    subject,
    snippet: msg.snippet ?? null,
    bodySnippet: msg.snippet ?? null,
    receivedAt,
    gmailLabelIds: msg.labelIds ?? [],
    listUnsubscribe: getHeader(msg, "List-Unsubscribe"),
    inReplyTo: getHeader(msg, "In-Reply-To"),
    headerFromRaw,
    // RFC 3834 Auto-Submitted + legacy Precedence — fed to isBotSender.
    autoSubmittedHeader: getHeader(msg, "Auto-Submitted"),
    precedenceHeader: getHeader(msg, "Precedence"),
  };
}

function emptySummary(durationMs: number): IngestSummary {
  return {
    scanned: 0,
    created: 0,
    skipped: 0,
    bucketCounts: {},
    durationMs,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
