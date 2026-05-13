import "server-only";
import { z } from "zod";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import { extractEmailBody } from "@/lib/agent/email/body-extract";
import type { ToolExecutor } from "./types";

// 2026-05-07 — chat agent's email tools. Steadii's L1/L2 ingest pipeline
// has been classifying + storing email metadata in `inbox_items` since
// Phase 6. The chat agent registry never exposed any read access to
// that data, so cross-source questions ("does this email URL match the
// calendar Meet URL?", "did Prof X reply yet?") always failed — the
// agent had to ask the user to "show" the email, defeating the
// secretary pivot. These two tools open eager-read access to the same
// inbox_items the inbox surface uses.
//
// `email_search` queries the table — sender + subject + snippet — for
// fast keyword filtering. `email_get_body` fetches the full Gmail body
// on demand for cases where the snippet doesn't carry enough detail
// (URLs, long quoted threads, etc.).

// ---------- email_search ----------

// 2026-05-07 — bumped default 30 → 90. Ryuto's questions routinely
// reach back further than a month ("did Prof X reply to my exam-prep
// question last semester?", "did the recruiter follow up after the
// final round?"). 90 days covers a typical academic semester boundary
// and the cost of returning extra rows is bounded by `limit`.
const SEARCH_DAYS_DEFAULT = 90;
const SEARCH_DAYS_MAX = 365;
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;

const searchArgs = z.object({
  query: z.string().min(1).max(200).optional(),
  senderEmail: z.string().email().optional(),
  senderDomain: z.string().min(1).max(120).optional(),
  sinceDays: z
    .number()
    .int()
    .positive()
    .max(SEARCH_DAYS_MAX)
    .optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(SEARCH_LIMIT_MAX)
    .optional(),
});

export type EmailSearchHit = {
  inboxItemId: string;
  threadExternalId: string | null;
  externalId: string;
  senderEmail: string;
  senderName: string | null;
  senderDomain: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
};

export const emailSearch: ToolExecutor<
  z.infer<typeof searchArgs>,
  { hits: EmailSearchHit[]; truncated: boolean }
> = {
  schema: {
    name: "email_search",
    description:
      "Search the user's classified inbox (Steadii's email store). Returns EVERY email Steadii has classified for the user regardless of follow-up state — open, replied/sent, dismissed, snoozed, archived all come back. Use when the user references an email by sender, subject, content keyword, or recency. At least one of `query` / `senderEmail` / `senderDomain` should be set; passing all three narrows further. Default lookback is 90 days; pass `sinceDays` up to 365 when the user references something further back. Returns up to `limit` (default 20) most-recent hits with sender + subject + snippet. For full body text call `email_get_body` with the returned `inboxItemId`. Eager — call without confirmation when the user references email content. STRATEGY: search by ENTITY first (one sender / company / course-code / person token), then call `email_get_body` for details that live in the body (deadlines, day counts, URLs, numbers). `query` performs AND-search across whitespace-separated tokens against subject + snippet + senderName (display name on the From line). Layering specifics on top of the entity (e.g. `LayerX 返信期限`) usually collapses results to zero because the specific keyword rarely appears in subject + snippet — search by entity alone first. WHEN 0 HITS on a multi-character query, retry with shorter substrings or token splits before giving up: e.g. `令和とレベル` → 0 → retry with `令和` (or `レベル`) → catches `令和トラベル`. Typos and JP particles (と/の/は/が) in user input are common; one retry-with-shorter-substring is cheaper than asking the user to re-state.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword(s) to match against subject + snippet (case-insensitive substring). Whitespace-separated tokens are AND-combined — every token must appear in subject or snippet (within a token, subject OR snippet still matches). Prefer a SINGLE entity token (sender name, company, course code, person). Adding specifics on top (deadlines, day counts, URLs) usually zeros the result because that detail lives in the body, not the snippet — use `email_get_body` for body-only details after the entity hit.",
        },
        senderEmail: {
          type: "string",
          description: "Exact sender email (e.g. `prof@uni.edu`).",
        },
        senderDomain: {
          type: "string",
          description:
            "Sender domain without the `@` (e.g. `uni.edu`). Use when the user names a sender by org rather than address.",
        },
        sinceDays: {
          type: "integer",
          description: `Lookback window in days. Default ${SEARCH_DAYS_DEFAULT}, max ${SEARCH_DAYS_MAX}.`,
          minimum: 1,
          maximum: SEARCH_DAYS_MAX,
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: SEARCH_LIMIT_MAX,
        },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = searchArgs.parse(rawArgs ?? {});
    const sinceDays = args.sinceDays ?? SEARCH_DAYS_DEFAULT;
    const limit = args.limit ?? SEARCH_LIMIT_DEFAULT;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const conditions: SQL[] = [
      eq(inboxItems.userId, ctx.userId),
      isNull(inboxItems.deletedAt),
      gte(inboxItems.receivedAt, since),
    ];
    if (args.senderEmail) {
      conditions.push(eq(inboxItems.senderEmail, args.senderEmail));
    }
    if (args.senderDomain) {
      conditions.push(eq(inboxItems.senderDomain, args.senderDomain));
    }
    if (args.query) {
      // 2026-05-10 — split on whitespace and AND across tokens. The
      // previous behavior treated `query` as a single literal substring,
      // which silently mismatched the agent's mental model: any
      // multi-keyword `query` (e.g. "LayerX 返信") would 0-result
      // because that exact substring is never in subject + snippet.
      // Token-level AND matches what "search" means everywhere else.
      // Within a token, subject OR snippet OR senderName still matches.
      //
      // 2026-05-12 — senderName added to the OR. Without it the agent
      // can't find emails by company / person mentioned in the From-line
      // display name (e.g. "令和トラベル採用担当 <noreply@example.com>"):
      // sender_email lives in another column, the subject may not contain
      // the company name, and the snippet often skips it too.
      const tokens = args.query.trim().split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        const pattern = `%${token.replace(/[%_]/g, "\\$&")}%`;
        const tokenClause = or(
          ilike(inboxItems.subject, pattern),
          ilike(inboxItems.snippet, pattern),
          ilike(inboxItems.senderName, pattern)
        );
        if (tokenClause) conditions.push(tokenClause);
      }
    }

    const rows = await db
      .select({
        id: inboxItems.id,
        threadExternalId: inboxItems.threadExternalId,
        externalId: inboxItems.externalId,
        senderEmail: inboxItems.senderEmail,
        senderName: inboxItems.senderName,
        senderDomain: inboxItems.senderDomain,
        subject: inboxItems.subject,
        snippet: inboxItems.snippet,
        receivedAt: inboxItems.receivedAt,
      })
      .from(inboxItems)
      .where(and(...conditions))
      .orderBy(desc(inboxItems.receivedAt))
      .limit(limit + 1);

    const truncated = rows.length > limit;
    const slice = truncated ? rows.slice(0, limit) : rows;
    const hits: EmailSearchHit[] = slice.map((r) => ({
      inboxItemId: r.id,
      threadExternalId: r.threadExternalId,
      externalId: r.externalId,
      senderEmail: r.senderEmail,
      senderName: r.senderName,
      senderDomain: r.senderDomain,
      subject: r.subject,
      snippet: r.snippet,
      receivedAt: r.receivedAt.toISOString(),
    }));
    return { hits, truncated };
  },
};

// ---------- email_get_body ----------

const BODY_MAX_CHARS = 8000;

const getBodyArgs = z.object({
  inboxItemId: z.string().uuid(),
});

export type EmailBody = {
  inboxItemId: string;
  externalId: string;
  senderEmail: string;
  subject: string | null;
  receivedAt: string;
  body: string;
  truncated: boolean;
  format: "empty" | "text/plain" | "text/html_stripped";
};

export const emailGetBody: ToolExecutor<
  z.infer<typeof getBodyArgs>,
  EmailBody
> = {
  schema: {
    name: "email_get_body",
    description: `Fetch the full body text of an email by inbox_item id. Use when the snippet from \`email_search\` is not enough — long URLs, quoted threads, structured content — or when the user asks to compare specific content against another source (calendar event, syllabus, mistake note, etc.). Body text is truncated at ${BODY_MAX_CHARS} characters; \`truncated: true\` in the result indicates more content exists. Eager — call without confirmation when answering the user's read-intent question requires the full body.`,
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        inboxItemId: { type: "string" },
      },
      required: ["inboxItemId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const { inboxItemId } = getBodyArgs.parse(rawArgs);

    const [row] = await db
      .select({
        id: inboxItems.id,
        sourceType: inboxItems.sourceType,
        externalId: inboxItems.externalId,
        senderEmail: inboxItems.senderEmail,
        subject: inboxItems.subject,
        receivedAt: inboxItems.receivedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, inboxItemId),
          eq(inboxItems.userId, ctx.userId),
          isNull(inboxItems.deletedAt)
        )
      )
      .limit(1);

    if (!row) {
      throw new Error("Inbox item not found or not owned by user");
    }
    if (row.sourceType !== "gmail") {
      throw new Error(
        `Body fetch only supported for gmail items today; got ${row.sourceType}`
      );
    }

    const message = await getMessageFull(ctx.userId, row.externalId);
    const extracted = extractEmailBody(message);
    const text = extracted.text ?? "";
    const truncated = text.length > BODY_MAX_CHARS;
    const body = truncated ? text.slice(0, BODY_MAX_CHARS) : text;

    return {
      inboxItemId: row.id,
      externalId: row.externalId,
      senderEmail: row.senderEmail,
      subject: row.subject,
      receivedAt: row.receivedAt.toISOString(),
      body,
      truncated,
      format: extracted.format,
    };
  },
};

export const EMAIL_TOOLS = [emailSearch, emailGetBody];
