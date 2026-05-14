import "server-only";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import { extractEmailBody } from "@/lib/agent/email/body-extract";
import { stripQuotedHistory } from "@/lib/agent/email/quoted-block-stripper";
import type { ToolExecutor } from "./types";

// engineer-62 — structural fix for THREAD_ROLE_CONFUSED. Returns the
// sender's NEW message body with quoted-history (`>` lines, "On …
// wrote:" attributions, "-----Original Message-----" dividers, Outlook
// `差出人:` / `From:` header blocks) stripped. The agent's slot-
// extraction surface MUST be this tool, not `email_get_body`, so
// quoted-block slots are physically invisible at extraction time.
//
// Prompt-only enforcement of MUST-rule 9 was proven insufficient by
// the 2026-05-14 round-2 dogfood (令和トラベル) — agent extracted
// round-1 slots from the `>>` block and skipped every downstream
// gating rule (convert_timezone, infer_sender_norms, SLOT FEASIBILITY
// CHECK) because it had internally classified the misread slots as
// "already-accepted." Tool-level enforcement breaks the cascade.

const BODY_MAX_CHARS = 8000;

const getNewContentOnlyArgs = z.object({
  inboxItemId: z.string().uuid(),
});

export type EmailNewContentOnly = {
  inboxItemId: string;
  externalId: string;
  senderEmail: string;
  subject: string | null;
  receivedAt: string;
  newContentBody: string;
  newContentBodyLength: number;
  originalBodyLength: number;
  truncated: boolean;
  // True when the stripper removed > 95% of the body — the structure
  // likely didn't match a typical reply (entirely-quoted forward,
  // non-plaintext shape, etc.). When true, the original body is also
  // returned via `originalBody` so the agent can route around the
  // issue. `reason` carries a short human-readable hint.
  stripperFlagged: boolean;
  stripperReason?: string;
  originalBody?: string;
};

export const emailGetNewContentOnly: ToolExecutor<
  z.infer<typeof getNewContentOnlyArgs>,
  EmailNewContentOnly
> = {
  schema: {
    name: "email_get_new_content_only",
    description: `Get the sender's NEW message body with quoted history stripped — lines starting with \`>\` (any depth) and the email-client reply headers ('On YYYY-MM-DD … wrote:', '-----Original Message-----', Outlook's '差出人: … 送信日時: …') are removed. Returns only the content the sender is communicating in THIS message. Use when you need to extract slots / candidate dates / deadlines / action items from a reply email where the new content sits above quoted history. Pair with \`email_get_body\` when you also need the prior-thread context (e.g. to write a contextual response that references earlier discussion). Body text is truncated at ${BODY_MAX_CHARS} characters; \`truncated: true\` means more content exists. When \`stripperFlagged: true\` (> 95% of the body was stripped), the original body is also returned via \`originalBody\` — consider falling back to that or to \`email_get_body\`. Eager — call without confirmation on reply-intent turns.`,
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
    const { inboxItemId } = getNewContentOnlyArgs.parse(rawArgs);

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
    const fullText = extracted.text ?? "";
    const strip = stripQuotedHistory(fullText);

    const truncated = strip.newContentBody.length > BODY_MAX_CHARS;
    const newContentBody = truncated
      ? strip.newContentBody.slice(0, BODY_MAX_CHARS)
      : strip.newContentBody;

    const base: EmailNewContentOnly = {
      inboxItemId: row.id,
      externalId: row.externalId,
      senderEmail: row.senderEmail,
      subject: row.subject,
      receivedAt: row.receivedAt.toISOString(),
      newContentBody,
      newContentBodyLength: newContentBody.length,
      originalBodyLength: strip.originalBodyLength,
      truncated,
      stripperFlagged: strip.stripperFlagged,
    };

    if (strip.stripperFlagged) {
      const originalTruncated =
        fullText.length > BODY_MAX_CHARS
          ? fullText.slice(0, BODY_MAX_CHARS)
          : fullText;
      base.originalBody = originalTruncated;
      base.stripperReason =
        "stripped >95% — possible structure unrecognized; consider email_get_body as a fallback";
    }

    return base;
  },
};

export const EMAIL_GET_NEW_CONTENT_ONLY_TOOLS = [emailGetNewContentOnly];
