import "server-only";

// 2026-05-21 — Phase 2.5 of α-auto-cal. Builds an EmailSnapshot[]
// (the input shape of the mutual-agreement detector) by fetching a
// Gmail thread's full bodies and labelling each message as outbound
// (sent by the user) or inbound (received by the user).
//
// Used by the auto-calendar-create hook in ingest-recent.ts to assemble
// the thread context required by detectMutualAgreement.
//
// Fail-soft: returns null when Gmail isn't connected, the thread can't
// be fetched, or any other Gmail-side issue. Callers MUST treat null as
// "do nothing" — never block ingest on this.

import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  getGmailForUser,
  GmailNotConnectedError,
} from "@/lib/integrations/google/gmail";
import { extractEmailBody } from "./body-extract";
import type { EmailSnapshot } from "@/lib/agent/proactive/mutual-agreement-detector";

// Pulls the `From` and `Subject` headers from a Gmail message.
function getHeader(
  message: { payload?: { headers?: Array<{ name?: string | null; value?: string | null }> } },
  name: string,
): string | null {
  const headers = message.payload?.headers ?? [];
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === name.toLowerCase()) {
      return h.value ?? null;
    }
  }
  return null;
}

// Email-form `John Doe <jdoe@example.com>` → `jdoe@example.com`.
// Falls back to the input when no angle brackets are present.
function extractAddress(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim().toLowerCase();
}

export async function fetchThreadForAutoCal(args: {
  userId: string;
  threadExternalId: string | null;
}): Promise<EmailSnapshot[] | null> {
  if (!args.threadExternalId) return null;

  // Resolve the user's email so we can label each message as outbound
  // (user is the sender) vs inbound (someone else is).
  const [userRow] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!userRow?.email) return null;
  const userEmailLower = userRow.email.trim().toLowerCase();

  return Sentry.startSpan(
    {
      name: "gmail.threads.get.autocal",
      op: "http.client",
      attributes: {
        "steadii.user_id": args.userId,
        "gmail.thread_id": args.threadExternalId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(args.userId);
        const res = await gmail.users.threads.get({
          userId: "me",
          id: args.threadExternalId!,
          format: "full",
        });
        const msgs = res.data.messages ?? [];

        const snapshots: EmailSnapshot[] = [];
        for (const m of msgs) {
          const from = getHeader(m, "From");
          const subject = getHeader(m, "Subject") ?? undefined;
          const internalMs = Number(m.internalDate ?? 0);
          if (!from || !Number.isFinite(internalMs) || internalMs <= 0) {
            continue;
          }
          const senderEmail = extractAddress(from);
          const direction: EmailSnapshot["direction"] =
            senderEmail === userEmailLower ? "outbound" : "inbound";

          const body = extractEmailBody(m).text;
          if (!body) continue;

          snapshots.push({
            direction,
            sentAt: new Date(internalMs).toISOString(),
            subject,
            body,
          });
        }

        // Sort chronologically. Gmail typically returns in order but
        // doesn't guarantee it.
        snapshots.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
        return snapshots;
      } catch (err) {
        if (err instanceof GmailNotConnectedError) return null;
        // Don't fail the ingest pipeline if a thread fetch errors.
        // Auto-cal is best-effort — degrade silently.
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "threads.get.autocal" },
          user: { id: args.userId },
        });
        return null;
      }
    },
  );
}
