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
} from "@/lib/integrations/google/gmail";
import * as Sentry from "@sentry/nextjs";
import { applyTriageResult, triageMessage } from "./triage";
import { logEmailAudit } from "./audit";
import { processL2 } from "./l2";
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
        // Synchronously run the L2 pipeline for ambiguous (l2_pending) and
        // high-risk (auto_high) messages. auto_high items skip the risk
        // pass — the L1 rule is strict per memory, so we pass
        // forceTier:"high" and go straight to deep+draft. Without this
        // the Inbox UI can't deep-link auto_high rows (no agent_draft
        // exists to link to).
        //
        // α volume is ≤20 such items per user per 24h — queue is post-α.
        // Failures are isolated per item so one bad message doesn't
        // poison the ingest.
        if (
          result.bucket === "l2_pending" ||
          result.bucket === "auto_high"
        ) {
          try {
            await processL2(
              row.id,
              result.bucket === "auto_high" ? { forceTier: "high" } : {}
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
