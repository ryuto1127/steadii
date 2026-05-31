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

// Auto-cal modules are lazy-imported inside maybeAutoCreateCalendarEvent
// so the existing ingest-recent-routing.test.ts (which mocks specific
// dependencies but not @/lib/db/client) still sees the unchanged
// top-level import surface. Dynamic imports add ~0 cost in prod after
// the first call (module cache).

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
      // Self-filter — Steadii's own outbound mail (digest, drafts, system
      // messages) sent from @mysteadii.com (or legacy @mysteadii.xyz) must
      // never reach the user's inbox queue. Gate before classify so we
      // don't burn LLM credits on our own outbound traffic. Case-insensitive
      // + trim guards against header oddities from intermediate relays.
      if (isSteadiiSelfSender(input.fromEmail)) {
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

          // 2026-05-21 — Phase 2.5 of α-auto-cal. After L2 lands, check
          // whether the thread has reached mutual scheduling agreement
          // and (if so) auto-create a [Steadii]-prefixed calendar event.
          //
          // Gating: only scheduling-likely buckets (auto_high /
          // auto_medium / l2_pending), and only when the message is part
          // of a real Gmail thread (threadExternalId set). The detector
          // is conservative (≥ 0.80 threshold + both-side requirements),
          // and the evaluator's idempotency partial unique index
          // prevents duplicate creates if this hook re-fires on retry.
          //
          // Fail-soft: any error here (Gmail rate limit, calendar API
          // hiccup, missing user.timezone) is swallowed + reported via
          // Sentry. Auto-cal is best-effort; failures must never poison
          // the inbox ingest.
          try {
            await maybeAutoCreateCalendarEvent({
              userId,
              row,
              inputBody: input.bodySnippet ?? input.snippet ?? "",
              inputSubject: input.subject ?? "",
            });
          } catch (err) {
            Sentry.captureException(err, {
              tags: { feature: "auto_cal", phase: "ingest" },
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

// Steadii's own outbound senders. The .xyz suffix is the legacy domain
// retained for backward compat with rows ingested before the .com cutover;
// once a sweep confirms no live mail is sent from .xyz it can be dropped.
const SELF_SENDER_DOMAINS = ["@mysteadii.com", "@mysteadii.xyz"] as const;

export function isSteadiiSelfSender(senderEmail: string | null | undefined): boolean {
  if (!senderEmail) return false;
  const normalized = senderEmail.trim().toLowerCase();
  // Accept the "Name <email>" display form: when the value carries a
  // bracketed address, test what's inside the brackets. The bare-email
  // path still falls through to the endsWith check below.
  const bracketed = normalized.match(/<([^>]*)>/);
  const candidate = bracketed ? bracketed[1].trim() : normalized;
  return SELF_SENDER_DOMAINS.some((domain) => candidate.endsWith(domain));
}

// Name-based fallback for rows whose sender email is null/odd but whose
// from-name clearly identifies Steadii's own agent. Our digest from-name
// is "Steadii Agent" (see lib/integrations/resend/client.ts getFromAddress).
export function isSteadiiSelfSenderName(
  senderName: string | null | undefined
): boolean {
  if (!senderName) return false;
  return senderName.trim().toLowerCase().startsWith("steadii agent");
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

// ---------------------------------------------------------------------------
// 2026-05-21 — Phase 2.5 of α-auto-cal. Assemble the thread context
// required by detectMutualAgreement and call the evaluator. The
// evaluator handles all the gating (opt-in, idempotency, threshold)
// internally — this wrapper just fetches the inputs.
// ---------------------------------------------------------------------------

async function maybeAutoCreateCalendarEvent(args: {
  userId: string;
  row: { id: string; threadExternalId: string | null; senderEmail: string; receivedAt: Date };
  inputBody: string;
  inputSubject: string;
}): Promise<void> {
  const { userId, row, inputBody, inputSubject } = args;

  // Look up the user's TZ for the evaluators. inboxItems.receivedAt
  // anchors the referenceYear so undated date text ("5/22") binds to
  // the right year.
  const userTimezone = await loadUserTimezone(userId);
  const referenceYear = row.receivedAt.getUTCFullYear();

  const { inferSenderTimezone } = await import("./sender-timezone-heuristic");

  // --------- (a) mutual-agreement (thread-based) ---------
  if (row.threadExternalId) {
    const { fetchThreadForAutoCal } = await import("./thread-for-autocal");
    const thread = await fetchThreadForAutoCal({
      userId,
      threadExternalId: row.threadExternalId,
    });
    if (thread && thread.length >= 2) {
      const latestInbound = [...thread]
        .reverse()
        .find((m) => m.direction === "inbound");
      const senderTzInference = inferSenderTimezone({
        domain: row.senderEmail.includes("@")
          ? row.senderEmail.split("@").pop() ?? null
          : null,
        body: latestInbound?.body ?? null,
      });
      const defaultTimezone = senderTzInference.tz ?? "UTC";

      const { evaluateAndCreateIfAgreed } = await import(
        "@/lib/agent/proactive/auto-calendar-create"
      );
      try {
        await evaluateAndCreateIfAgreed({
          userId,
          inboxItemId: row.id,
          thread,
          userTimezone,
          defaultTimezone,
          referenceYear,
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "auto_cal", phase: "ingest_mutual" },
          user: { id: userId },
        });
      }
    }
  }

  // --------- (b) deadline (single-mail body scan) ---------
  // 2026-05-21 — Phase 5. Independent of thread context — fires on
  // single inbound mails that mention a strong deadline keyword
  // + date. The mutual-agreement and deadline detectors can BOTH
  // fire on the same inbox_item (idempotency is keyed on `kind`).
  const deadlineSenderTz = inferSenderTimezone({
    domain: row.senderEmail.includes("@")
      ? row.senderEmail.split("@").pop() ?? null
      : null,
    body: inputBody,
  });
  const defaultDeadlineTz = deadlineSenderTz.tz ?? userTimezone;

  const { evaluateAndAddDeadlineIfDetected } = await import(
    "@/lib/agent/proactive/auto-deadline-create"
  );
  try {
    await evaluateAndAddDeadlineIfDetected({
      userId,
      inboxItemId: row.id,
      body: inputBody,
      subject: inputSubject,
      defaultTimezone: defaultDeadlineTz,
      referenceYear,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "auto_cal", phase: "ingest_deadline" },
      user: { id: userId },
    });
  }

  // --------- (c) scheduled event (single-mail body scan) ---------
  // 2026-05-27 — One-sided scheduled-event detector. Fires on inbound
  // confirmations of things the student registered for / was booked
  // into (webinars, appointments, orientations) — a structured signal
  // + a TIMED date. Reuses the same sender-TZ inference + referenceYear
  // as the deadline block. Independent of (a)/(b): all three can fire
  // on the same inbox_item (idempotency keyed on `kind`). The event
  // detector requires a start time, so it won't double-fire with the
  // deadline detector (which is date-only / all-day).
  const { evaluateAndAddEventIfDetected } = await import(
    "@/lib/agent/proactive/auto-event-create"
  );
  try {
    await evaluateAndAddEventIfDetected({
      userId,
      inboxItemId: row.id,
      body: inputBody,
      subject: inputSubject,
      defaultTimezone: defaultDeadlineTz,
      referenceYear,
      receivedAtMs: row.receivedAt.getTime(),
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "auto_cal", phase: "ingest_event" },
      user: { id: userId },
    });
  }
}

async function loadUserTimezone(userId: string): Promise<string> {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [u] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.timezone ?? "UTC";
}
