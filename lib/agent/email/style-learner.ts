import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRules, agentSenderFeedback } from "@/lib/db/schema";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";

// engineer-38 — daily learner. Consumes the (original, edited) pairs the
// send-execute path captured into agent_sender_feedback and distills up
// to 5 short writing-style rules in the user's voice ("Use 確認 instead
// of ご確認."). Writes them as agent_rules rows with scope='writing_style'
// and source='edit_delta_learner'; the L2 draft prompt picks them up
// from there (lib/agent/email/l2.ts loads them per draft).
//
// Trigger: /api/cron/style-learner @ daily 8am via QStash. The cron iterates
// users with ≥MIN_SIGNAL unprocessed deltas. Manual re-trigger isn't
// currently exposed — the daily cadence is fast enough for α.

const MIN_SIGNAL_ROWS = 5;
const READ_LIMIT = 20;
const MAX_RULES = 5;
const MAX_RULE_CHARS = 200;

export type ExtractWritingStyleRulesResult = {
  rules: string[];
  // Number of (original, edited) pairs that fed the model. < MIN_SIGNAL_ROWS
  // → the function early-returns with rules=[] (caller treats as no-op).
  signalCount: number;
  // Whether the function actually wrote any rows. False when signalCount
  // is below MIN_SIGNAL_ROWS or the model returned an unparseable response.
  rulesWritten: number;
};

export async function extractWritingStyleRules(
  userId: string
): Promise<ExtractWritingStyleRulesResult> {
  return Sentry.startSpan(
    {
      name: "email.style_learner.extract",
      op: "gen_ai.generate",
      attributes: {
        "steadii.user_id": userId,
        "steadii.task_type": "email_draft",
      },
    },
    async () => {
      const pairs = await db
        .select({
          original: agentSenderFeedback.originalDraftBody,
          edited: agentSenderFeedback.editedBody,
        })
        .from(agentSenderFeedback)
        .where(
          and(
            eq(agentSenderFeedback.userId, userId),
            isNotNull(agentSenderFeedback.editedBody),
            isNotNull(agentSenderFeedback.originalDraftBody)
          )
        )
        .orderBy(desc(agentSenderFeedback.createdAt))
        .limit(READ_LIMIT);

      const filtered = pairs.filter(
        (p): p is { original: string; edited: string } =>
          typeof p.original === "string" &&
          typeof p.edited === "string" &&
          p.original.trim().length > 0 &&
          p.edited.trim().length > 0 &&
          p.original !== p.edited
      );

      if (filtered.length < MIN_SIGNAL_ROWS) {
        return { rules: [], signalCount: filtered.length, rulesWritten: 0 };
      }

      const corpus = filtered
        .map(
          (p, i) =>
            `Pair ${i + 1}\nOriginal: ${p.original.trim()}\nFinal: ${p.edited.trim()}`
        )
        .join("\n\n");

      // 2026-05-11 — was `email_draft` (GPT-5.4 full). Style rule extraction
      // from (original, edited) pairs is a pattern-matching task with short
      // JSON output (≤5 rules) — mini handles it cleanly. Matches the
      // persona-learner downgrade rationale.
      const model = selectModel("email_classify_risk");
      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: corpus },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "writing_style_rules",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                rules: {
                  type: "array",
                  items: { type: "string", minLength: 1, maxLength: MAX_RULE_CHARS },
                  maxItems: MAX_RULES,
                },
              },
              required: ["rules"],
            },
          },
        },
      });

      await recordUsage({
        userId,
        model,
        taskType: "email_draft",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          })?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const raw = resp.choices[0]?.message?.content ?? "{}";
      const rules = parseRules(raw);
      const written = await persistWritingStyleRules(userId, rules);

      return {
        rules,
        signalCount: filtered.length,
        rulesWritten: written,
      };
    }
  );
}

const SYSTEM_PROMPT = `Given the (Original, Final) email-body pairs below, extract up to ${MAX_RULES} short writing-style rules in the user's voice.

Each rule should be a single sentence describing a pattern the user prefers — what they CHANGE FROM the original or what they CONSISTENTLY ADD.

Examples:
- "Use 確認 instead of ご確認."
- "Drop trailing よろしく when the recipient is a peer."
- "Use 'Thanks' instead of 'Thank you very much' as sign-off for casual replies."
- "Tighten run-on sentences into shorter clauses separated by periods."

Rules must be:
- Specific and actionable — a draft model could check whether it's following each one.
- Generalizable — the rule should apply to FUTURE drafts, not be specific to one email's content.
- In the user's working language (English unless the pairs are entirely Japanese).

Return JSON: { "rules": [string, ...] }. If you can't find ${MIN_SIGNAL_ROWS} clear patterns, return fewer (or an empty array). Don't pad with weak rules.`;

function parseRules(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const obj = (parsed ?? {}) as { rules?: unknown };
  if (!Array.isArray(obj.rules)) return [];
  return obj.rules
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .slice(0, MAX_RULES);
}

// Replace strategy: soft-delete the user's existing learner-sourced rules
// and insert the fresh slate. Manual rules (the user's own
// /how-your-agent-thinks deletions, future direct manual writes) stay
// because they're scoped to source != 'edit_delta_learner'. We keep
// rows soft-deleted instead of hard-deleting so historical analysis can
// see what rules used to fire.
async function persistWritingStyleRules(
  userId: string,
  rules: string[]
): Promise<number> {
  const now = new Date();
  await db
    .update(agentRules)
    .set({ deletedAt: now, enabled: false, updatedAt: now })
    .where(
      and(
        eq(agentRules.userId, userId),
        eq(agentRules.scope, "writing_style"),
        eq(agentRules.source, "edit_delta_learner"),
        isNull(agentRules.deletedAt)
      )
    );

  let written = 0;
  for (const rule of rules) {
    try {
      const trimmed = rule.slice(0, MAX_RULE_CHARS);
      // matchValue is "*" (global) per spec; the rule sentence lives in
      // `reason`. matchNormalized stays unique per rule sentence so the
      // upsert doesn't collide when two distinct rules want the same
      // (user, scope, "*") slot — Drizzle's unique index keys on
      // matchNormalized, so we encode the sentence there.
      await db
        .insert(agentRules)
        .values({
          userId,
          scope: "writing_style",
          matchValue: "*",
          matchNormalized: `writing_style:${trimmed.toLowerCase()}`,
          source: "edit_delta_learner",
          reason: trimmed,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [
            agentRules.userId,
            agentRules.scope,
            agentRules.matchNormalized,
          ],
          set: {
            enabled: true,
            deletedAt: null,
            reason: trimmed,
            updatedAt: now,
          },
        });
      written++;
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "style_learner", op: "upsert" },
        user: { id: userId },
      });
    }
  }
  return written;
}

// Helper for the cron + admin paths — count of unprocessed deltas for a
// given user. "Unprocessed" is approximated by "exists at all" since
// each cron run regenerates the full slate. A lightweight check the cron
// uses to skip users who have nothing new since last run.
export async function countSignalRowsForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ id: agentSenderFeedback.id })
    .from(agentSenderFeedback)
    .where(
      and(
        eq(agentSenderFeedback.userId, userId),
        isNotNull(agentSenderFeedback.editedBody),
        isNotNull(agentSenderFeedback.originalDraftBody)
      )
    )
    .limit(READ_LIMIT);
  return rows.length;
}
