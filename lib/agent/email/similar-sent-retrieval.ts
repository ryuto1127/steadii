import "server-only";
import * as Sentry from "@sentry/nextjs";
import { getGmailForUser } from "@/lib/integrations/google/gmail";
import {
  extractEmailBody,
  type ExtractedBody,
} from "./body-extract";
import { getHeader, parseAddress } from "@/lib/integrations/google/gmail-fetch";

// 2026-05-08 — per-message similar-content sent retrieval. The voice
// profile (engineer-38) gives a 200-char global style summary; the
// sender-history fanout slot gives K=3 past replies to the SAME
// recipient. Neither covers the middle ground: "first-time recipient,
// but Ryuto has written lots of similar-context emails before."
//
// This loader queries Gmail's native search for past sent messages
// that share keywords with the incoming subject + snippet, returning
// up to K concrete few-shot examples for the L2 draft prompt. We
// deliberately exclude the same recipient (already covered by
// sender-history) so the slate is additive, not redundant.
//
// Heuristic, no embeddings yet — Gmail's own relevance ranking handles
// the search. A future stage can swap in a sent_email_embeddings table
// for true semantic match; for now, keyword search at α scale is good
// enough and ships without infra.

const GMAIL_OVERFETCH = 10;
const MIN_KEYWORD_CHARS = 3;
const MAX_KEYWORDS = 3;

// Stopwords that turn a Gmail search into noise. EN + JA + structural.
// Gmail's tokenizer is loose with CJK so we keep the JA list narrow.
const STOPWORDS_EN = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "from",
  "this",
  "that",
  "have",
  "has",
  "are",
  "was",
  "will",
  "can",
  "not",
  "but",
  "what",
  "when",
  "where",
  "how",
  "why",
  "would",
  "could",
  "should",
  "regarding",
  "about",
  "please",
  "thanks",
  "thank",
  "hi",
  "hello",
  "dear",
  "best",
  "regards",
  "re",
  "fwd",
  "subject",
]);

const STOPWORDS_JA = new Set([
  "について",
  "お願い",
  "お願いします",
  "ありがとう",
  "ありがとうございます",
  "よろしく",
  "よろしくお願いします",
  "件",
  "の件",
  "について",
  "の御連絡",
  "ご連絡",
  "皆様",
  "皆さま",
  "返信",
  "Re",
]);

export type SimilarSentEmail = {
  messageId: string;
  subject: string | null;
  body: string;
  sentAt: Date;
  recipientEmail: string | null;
  recipientName: string | null;
};

export async function findSimilarSentEmails(args: {
  userId: string;
  subject: string | null;
  snippet: string | null;
  excludeRecipientEmail: string | null;
  k: number;
}): Promise<SimilarSentEmail[]> {
  return Sentry.startSpan(
    {
      name: "email.fanout.similar_sent",
      op: "http.client",
      attributes: {
        "steadii.user_id": args.userId,
      },
    },
    async () => {
      const keywords = extractKeywords(args.subject, args.snippet);
      if (keywords.length === 0) return [];

      try {
        const gmail = await getGmailForUser(args.userId);
        // Gmail search syntax: `in:sent` + space-separated keywords.
        // Quote each keyword to keep multi-word JA tokens intact and
        // prevent Gmail from splitting Latin letters mid-word.
        const q =
          "in:sent " +
          keywords.map((k) => `"${k.replace(/"/g, "")}"`).join(" ");
        const list = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: Math.max(args.k, GMAIL_OVERFETCH),
        });
        const ids = (list.data.messages ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length === 0) return [];

        const out: SimilarSentEmail[] = [];
        for (const id of ids) {
          if (out.length >= args.k) break;
          try {
            const res = await gmail.users.messages.get({
              userId: "me",
              id,
              format: "full",
            });
            const msg = res.data;
            const toHeader = getHeader(msg, "To");
            const recipient = parseAddress(toHeader);
            if (
              args.excludeRecipientEmail &&
              recipient.email.toLowerCase() ===
                args.excludeRecipientEmail.toLowerCase()
            ) {
              // Already covered by senderHistory — drop to avoid
              // redundancy. The slate stays additive.
              continue;
            }
            const subject = getHeader(msg, "Subject");
            const extracted: ExtractedBody = extractEmailBody(msg);
            const body = stripQuotedReplies(extracted.text ?? "");
            if (body.length < 10) {
              // Skip empty / forwarded-only bodies; they're noise as
              // few-shot examples.
              continue;
            }
            const sentAt = parseSentAt(msg.internalDate);
            if (!sentAt) continue;
            out.push({
              messageId: id,
              subject,
              body,
              sentAt,
              recipientEmail: recipient.email || null,
              recipientName: recipient.name,
            });
          } catch (err) {
            Sentry.captureException(err, {
              level: "warning",
              tags: { feature: "fanout_similar_sent", op: "gmail_get" },
              user: { id: args.userId },
            });
          }
        }
        return out;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "fanout_similar_sent", op: "gmail_list" },
          user: { id: args.userId },
        });
        return [];
      }
    }
  );
}

// Pure helper — extracted so unit tests can assert keyword shape
// without a Gmail mock. Picks up to `MAX_KEYWORDS` distinctive tokens
// from subject + snippet, prioritising subject (subjects encode topic)
// and dropping stopwords + very-short tokens.
export function extractKeywords(
  subject: string | null,
  snippet: string | null
): string[] {
  const subjectTokens = tokenize(subject ?? "");
  const snippetTokens = tokenize(snippet ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  // Prefer subject tokens first; they encode topic more reliably than
  // body snippets which often start with greetings.
  for (const t of [...subjectTokens, ...snippetTokens]) {
    if (out.length >= MAX_KEYWORDS) break;
    const norm = t.trim();
    if (!norm) continue;
    if (norm.length < MIN_KEYWORD_CHARS) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    if (STOPWORDS_EN.has(key) || STOPWORDS_JA.has(norm)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

function tokenize(text: string): string[] {
  // Split on whitespace + ASCII punctuation. Keeps CJK runs intact so
  // 「数学の課題」 stays as a single useful token rather than fragmenting.
  // Latin tokens get split on hyphens/underscores too.
  return text
    .replace(/[、。！？「」『』"'(),.;:!?#@\[\]{}<>\\/_-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function stripQuotedReplies(body: string): string {
  // Drops everything from the first `>` reply marker or "On <date>,
  // <name> wrote:" header onward. Matches voice-profile's strip rule.
  const idx = body.search(/^(?:>+|On .+ wrote:)/m);
  if (idx >= 0) return body.slice(0, idx).trim();
  return body.trim();
}

function parseSentAt(internalDate: string | null | undefined): Date | null {
  if (!internalDate) return null;
  const ms = Number(internalDate);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}
