import "server-only";
import * as Sentry from "@sentry/nextjs";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import { extractEmailBody } from "./body-extract";

// Shared full-body fetch used by both the L2 pipeline (classify/draft
// grounding) and the pre-send fact-checker (grounding the outgoing draft
// against what the inbound email actually said). Centralizing it means
// both surfaces use the same source + the same FULL_BODY_CHAR_CAP, so the
// checker can never ground against a smaller slice than the draft was
// generated from.
//
// The ~120-char Gmail snippet leaves the substance of structured emails
// (scheduling, official notices) past the snippet boundary. Drafts are
// generated from the full body; grounding the pre-send check against the
// snippet was a false-negative source — the checker couldn't see the
// dates/names the draft legitimately referenced, so it would flag valid
// claims (or, worse, miss that a claim WAS supported). Fetch the same
// full body the draft used.
export const FULL_BODY_CHAR_CAP = 8000;

// Fetch + extract the full Gmail body for an inbox item, capped at
// FULL_BODY_CHAR_CAP. Returns null when the item isn't a Gmail message,
// the body is empty, or the fetch fails — callers fall back to the
// snippet. Failures are logged at warning level (never thrown) so the
// pipeline degrades to snippet-grounding rather than blocking.
export async function fetchFullBodyForInbox(item: {
  userId: string;
  inboxItemId: string;
  sourceType: string;
  externalId: string;
}): Promise<string | null> {
  if (item.sourceType !== "gmail") return null;
  try {
    const message = await getMessageFull(item.userId, item.externalId);
    const extracted = extractEmailBody(message);
    const raw = (extracted.text ?? "").trim();
    if (raw.length === 0) return null;
    return raw.length > FULL_BODY_CHAR_CAP
      ? raw.slice(0, FULL_BODY_CHAR_CAP)
      : raw;
  } catch (err) {
    Sentry.captureException(err, {
      level: "warning",
      tags: { feature: "email_full_body", op: "fetch_full_body" },
      user: { id: item.userId },
      extra: { inboxItemId: item.inboxItemId },
    });
    return null;
  }
}
