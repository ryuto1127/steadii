import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { gmail_v1 } from "googleapis";
import { getGmailForUser } from "./gmail";
import { extractEmailBody } from "@/lib/agent/email/body-extract";

// Max messages to fetch in one `listRecentMessages` call. Gmail caps
// maxResults at 500, but the first-24h ingest path almost never needs more
// than ~200 for a heavy student inbox. Keeping the cap low keeps the ingest
// quick and predictable; W3's ongoing ingest will paginate further.
const LIST_PAGE_SIZE = 100;
const LIST_HARD_LIMIT = 500;

export type GmailListHit = {
  id: string;
  threadId: string | null;
};

// Thin wrapper around `users.messages.list` that handles pagination and
// honors 429 Retry-After. We pull IDs only; bodies are fetched lazily via
// `getMessage`.
export async function listRecentMessages(
  userId: string,
  sinceUnixSeconds: number,
  hardLimit: number = LIST_HARD_LIMIT
): Promise<GmailListHit[]> {
  return Sentry.startSpan(
    {
      name: "gmail.messages.list",
      op: "http.client",
      attributes: { "steadii.user_id": userId, "gmail.since": sinceUnixSeconds },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const q = `after:${sinceUnixSeconds}`;
        const out: GmailListHit[] = [];
        let pageToken: string | undefined = undefined;

        while (out.length < hardLimit) {
          const res = await requestWithRetry(() =>
            gmail.users.messages.list({
              userId: "me",
              q,
              maxResults: Math.min(LIST_PAGE_SIZE, hardLimit - out.length),
              pageToken,
            })
          );
          const page = res.data.messages ?? [];
          for (const m of page) {
            if (m.id) out.push({ id: m.id, threadId: m.threadId ?? null });
          }
          const next = res.data.nextPageToken;
          if (!next) break;
          pageToken = next;
        }

        return out;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "messages.list" },
          user: { id: userId },
        });
        throw err;
      }
    }
  );
}

// Full message fetch. `format: "metadata"` returns headers + snippet without
// the body, which is everything L1 rules need. If W2 wants the body it
// upgrades to `format: "full"` per-item, not in the ingest.
export async function getMessage(
  userId: string,
  messageId: string
): Promise<gmail_v1.Schema$Message> {
  return Sentry.startSpan(
    {
      name: "gmail.messages.get",
      op: "http.client",
      attributes: {
        "steadii.user_id": userId,
        "gmail.message_id": messageId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const res = await requestWithRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "metadata",
            metadataHeaders: [
              "From",
              "To",
              "Cc",
              "Subject",
              "Date",
              "List-Unsubscribe",
              "In-Reply-To",
              "References",
              "Reply-To",
            ],
          })
        );
        return res.data;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "messages.get" },
          user: { id: userId },
        });
        throw err;
      }
    }
  );
}

// Full-body fetch — returns the message with `payload.parts` populated
// with raw body data so the inbox-detail page can render the full
// email. Separate from `getMessage` (which uses `format: "metadata"`
// for the L1 / triage path) because most call sites don't need the
// body and Gmail charges quota proportional to the response size.
//
// Body parsing (text/plain vs text/html, base64url decode, charset
// handling) lives in `lib/agent/email/body-extract.ts`; this just
// returns the raw payload.
export async function getMessageFull(
  userId: string,
  messageId: string
): Promise<gmail_v1.Schema$Message> {
  return Sentry.startSpan(
    {
      name: "gmail.messages.get_full",
      op: "http.client",
      attributes: {
        "steadii.user_id": userId,
        "gmail.message_id": messageId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const res = await requestWithRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full",
          })
        );
        return res.data;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "messages.get_full" },
          user: { id: userId },
        });
        throw err;
      }
    }
  );
}

// Helpers — header extraction. Gmail's `payload.headers` is an array of
// `{ name, value }`; we always want case-insensitive matching because
// `From` / `FROM` / `from` all occur in the wild.
export function getHeader(
  msg: gmail_v1.Schema$Message,
  name: string
): string | null {
  const headers = msg.payload?.headers ?? [];
  const needle = name.toLowerCase();
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === needle) {
      return h.value ?? null;
    }
  }
  return null;
}

// 2026-05-08 — chat agent / sender-history fanout helper. Returns the
// user's most-recent direct-Gmail replies to a single recipient address,
// independent of whether they were drafted by Steadii. The fanout's
// existing senderHistory source only knows about Steadii-mediated sends
// (`agent_drafts.status='sent'`); when Ryuto replies via Gmail directly
// to a recurring contact, that signal is invisible to the L2 prompt
// without this helper.
//
// Returns subject + extracted body + sentAt (Date) + the gmail message
// id so callers can dedupe against `agent_drafts.gmailSentMessageId`.
// Body is run through `extractEmailBody` + quoted-reply stripping so
// the prompt sees only the user's own writing.
export type GmailDirectSentMessage = {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  body: string;
  sentAt: Date;
};

export async function fetchSentMessagesToRecipient(
  userId: string,
  recipientEmail: string,
  k: number
): Promise<GmailDirectSentMessage[]> {
  return Sentry.startSpan(
    {
      name: "gmail.messages.list_sent_to",
      op: "http.client",
      attributes: {
        "steadii.user_id": userId,
        "gmail.recipient": recipientEmail,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const list = await requestWithRetry(() =>
          gmail.users.messages.list({
            userId: "me",
            q: `in:sent to:${recipientEmail}`,
            maxResults: Math.max(1, k),
          })
        );
        const ids = (list.data.messages ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length === 0) return [];

        const out: GmailDirectSentMessage[] = [];
        // Sequential fetch keeps quota predictable. K is small (≤5
        // typically) so wallclock is bounded; parallelizing here saves
        // ~200ms total in the rare K=10 case but burns a quota burst.
        for (const id of ids) {
          try {
            const msg = await requestWithRetry(() =>
              gmail.users.messages.get({
                userId: "me",
                id,
                format: "full",
              })
            );
            const data = msg.data;
            const subject = getHeader(data, "Subject");
            const extracted = extractEmailBody(data);
            const body = stripQuotedReplies(extracted.text ?? "");
            const sentAt = parseSentAt(data);
            if (!sentAt) continue;
            out.push({
              messageId: id,
              threadId: data.threadId ?? null,
              subject,
              body,
              sentAt,
            });
          } catch (err) {
            Sentry.captureException(err, {
              level: "warning",
              tags: { integration: "gmail", op: "messages.get_sent_to" },
              user: { id: userId },
            });
          }
        }
        return out;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "messages.list_sent_to" },
          user: { id: userId },
        });
        throw err;
      }
    }
  );
}

function parseSentAt(msg: gmail_v1.Schema$Message): Date | null {
  // internalDate is the most reliable Gmail-side ordering signal — the
  // header `Date:` is user-controlled. Fallback to the Date header only
  // if internalDate is missing (rare).
  if (msg.internalDate) {
    const ms = Number(msg.internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  const dateHeader = getHeader(msg, "Date");
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (Number.isFinite(parsed)) return new Date(parsed);
  }
  return null;
}

function stripQuotedReplies(body: string): string {
  // Identical strip rule used by voice-profile.ts. Drops everything
  // from the first `>` reply marker or "On <date>, <name> wrote:" header
  // onward so the LLM sees only the user's own writing.
  const idx = body.search(/^(?:>+|On .+ wrote:)/m);
  if (idx >= 0) return body.slice(0, idx).trim();
  return body.trim();
}

// Parses an RFC-5322 address into `{ email, name }`. We accept the two
// common shapes: `"Name" <email>` and bare `email`. Anything more exotic
// (group syntax, quoted-string edge cases) falls back to `{ email: raw }`.
export function parseAddress(raw: string | null | undefined): {
  email: string;
  name: string | null;
} {
  if (!raw) return { email: "", name: null };
  const trimmed = raw.trim();
  const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(trimmed);
  if (m) {
    const name = (m[1] ?? "").trim();
    return { email: m[2]!.trim(), name: name.length > 0 ? name : null };
  }
  return { email: trimmed, name: null };
}

// Parses a comma-separated address-list header (To/Cc). Commas inside
// quoted display names are rare but possible; this splits naively but
// preserves `<...>` by ignoring commas inside angle brackets.
export function parseAddressList(
  raw: string | null | undefined
): Array<{ email: string; name: string | null }> {
  if (!raw) return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "<") depth++;
    else if (c === ">") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts
    .map((p) => parseAddress(p))
    .filter((p) => p.email.length > 0);
}

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

// Retry helper for Gmail API calls. Gmail returns 429 with a Retry-After
// header on rate-limit hits; 5xx warrants a short backoff. We do at most
// two retries to keep the ingest loop bounded.
async function requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { code?: number; response?: { status?: number } })
        ?.response?.status ??
        (err as { code?: number })?.code ?? 0;
      if (status === 429) {
        const retryAfterHeader = (
          err as { response?: { headers?: Record<string, string> } }
        )?.response?.headers?.["retry-after"];
        const retryMs = parseRetryAfter(retryAfterHeader) ?? backoffMs(attempt);
        await sleep(retryMs);
        attempt++;
        continue;
      }
      if (status >= 500 && status < 600) {
        await sleep(backoffMs(attempt));
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function backoffMs(attempt: number): number {
  return 300 * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
