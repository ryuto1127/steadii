import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { PreSendWarning } from "@/lib/db/schema";

// engineer-39 — pre-send fact-checker. Catches Apple-Intelligence-style
// hallucinations: a draft that mentions "the Friday meeting" when the
// thread context has no Friday, or a URL the model invented, etc.
//
// Pass: cheap GPT-5.4 Mini call (logged, NOT credit-metered — it's a
// tool-call equivalent). Bounded at 4K chars of context + 200 output
// tokens.
//
// Critical constraint (handoff), refined 2026-06-09: failure handling
// depends on whether a human is in the loop. ATTENDED callers (inbox
// detail, queue Send — failMode "open", the default) degrade to ok=true
// on any LLM error: we'd rather miss a hallucination than block a
// legitimate send the user is watching. The UNATTENDED auto-send path
// (failMode "closed") must NOT inherit that: with no human review, a
// checker outage returning ok=true would auto-send an unverified reply,
// so internal failures surface as ok=false + degraded=true and the
// caller holds the draft for review instead.

const MAX_CONTEXT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 220;
// Cap warnings to keep the modal compact — surfacing 10 dubious phrases
// trains the user to dismiss the modal rather than read it.
const MAX_WARNINGS = 5;

export type PreSendCheckInput = {
  userId: string;
  draftSubject: string;
  draftBody: string;
  // The original email body + (optional) prior thread messages, joined
  // into a single context string. Bounded at MAX_CONTEXT_CHARS by the
  // checker; callers can pre-trim if they want to bias toward the most
  // recent context.
  threadContext: string;
};

export type PreSendCheckResult = {
  ok: boolean;
  warnings: PreSendWarning[];
  // True when ok=false reflects a checker-internal failure (LLM error,
  // unparseable response) rather than an actual not-grounded verdict.
  // Only emitted under failMode "closed"; attended callers never see it.
  degraded?: boolean;
};

// "open"  — internal checker failures return ok=true (a human reviews the
//           draft anyway; never block their send on our outage).
// "closed" — internal failures return ok=false + degraded=true (no human
//           in the loop; the caller must hold the draft).
export type PreSendFailMode = "open" | "closed";

export async function checkDraftBeforeSend(
  input: PreSendCheckInput,
  opts: { failMode?: PreSendFailMode } = {}
): Promise<PreSendCheckResult> {
  const failMode = opts.failMode ?? "open";
  return Sentry.startSpan(
    {
      name: "email.pre_send_check",
      op: "gen_ai.classify",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.task_type": "email_classify_risk",
      },
    },
    async () => {
      try {
        const model = selectModel("email_classify_risk");
        const userMsg = buildUserMessage(input);
        const resp = await openai().chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pre_send_check",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ok: { type: "boolean" },
                  warnings: {
                    type: "array",
                    maxItems: MAX_WARNINGS,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        phrase: { type: "string", minLength: 1, maxLength: 200 },
                        why: { type: "string", minLength: 1, maxLength: 200 },
                      },
                      required: ["phrase", "why"],
                    },
                  },
                },
                required: ["ok", "warnings"],
              },
            },
          },
          max_completion_tokens: MAX_OUTPUT_TOKENS,
        });

        await recordUsage({
          userId: input.userId,
          model,
          taskType: "email_classify_risk",
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
          cachedTokens:
            (resp.usage as {
              prompt_tokens_details?: { cached_tokens?: number };
            })?.prompt_tokens_details?.cached_tokens ?? 0,
        });

        return parsePreSendCheck(
          resp.choices[0]?.message?.content ?? "{}",
          failMode
        );
      } catch (err) {
        // Attended contract: an LLM-side failure must not block sends a
        // human is reviewing. Unattended (failMode "closed"): the same
        // failure must hold the draft. Log at warning so we can spot
        // pathological outage rates without paging.
        Sentry.captureException(err, {
          level: "warning",
          tags: { feature: "pre_send_check", op: "openai_call" },
          user: { id: input.userId },
        });
        if (failMode === "closed") {
          return { ok: false, warnings: [], degraded: true };
        }
        return { ok: true, warnings: [] };
      }
    }
  );
}

const SYSTEM_PROMPT = `You are Steadii's pre-send fact-checker. You receive an outgoing email DRAFT and the THREAD CONTEXT it's replying to. Your job: flag any factual claim in the DRAFT that does NOT appear (or follow directly) from the THREAD CONTEXT.

Flag these (high precision — only when you're confident the claim isn't supported):
- Specific dates / days of week ("Friday at 2pm", "next Monday") not present in the context.
- Specific times ("3pm", "in two hours") not in the context.
- Names of people, classes, courses, or organizations not in the context.
- URLs not in the context.
- Event titles ("the kickoff meeting", "your office hours appointment") not in the context.
- Locations not in the context.
- Dollar amounts, deadlines, attachment references not in the context.

Do NOT flag:
- Generic greetings, sign-offs, or politeness ("hope you're well", "thanks for the update").
- Offers / proposals the user is making to the recipient ("I can come Tuesday at 3 if that works").
- Stylistic phrasing or word choices.
- Restatements / paraphrases of context content.
- The user's own opinions or feelings.

Output JSON:
- "ok": true when the draft passes (no warnings); false when at least one factual claim isn't grounded.
- "warnings": for each flagged item, { "phrase": <verbatim from draft>, "why": <one short sentence> }.

Be conservative. False positives train the user to dismiss the modal — only flag claims you're sure aren't in the context. When in doubt, return ok=true.`;

function buildUserMessage(input: PreSendCheckInput): string {
  const trimmedContext = input.threadContext.slice(0, MAX_CONTEXT_CHARS);
  return [
    "=== Thread context ===",
    trimmedContext.length > 0 ? trimmedContext : "(empty — no prior thread)",
    "",
    "=== Outgoing draft ===",
    `Subject: ${input.draftSubject}`,
    "",
    input.draftBody,
  ].join("\n");
}

export function parsePreSendCheck(
  raw: string,
  failMode: PreSendFailMode = "open"
): PreSendCheckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (failMode === "closed") {
      return { ok: false, warnings: [], degraded: true };
    }
    return { ok: true, warnings: [] };
  }
  const o = (parsed ?? {}) as { ok?: unknown; warnings?: unknown };
  const ok = typeof o.ok === "boolean" ? o.ok : true;
  const warnings: PreSendWarning[] = Array.isArray(o.warnings)
    ? o.warnings
        .filter((w): w is { phrase: unknown; why: unknown } => {
          return !!w && typeof w === "object";
        })
        .map((w) => {
          const phrase = typeof w.phrase === "string" ? w.phrase.trim() : "";
          const why = typeof w.why === "string" ? w.why.trim() : "";
          return { phrase, why };
        })
        .filter((w) => w.phrase.length > 0 && w.why.length > 0)
        .slice(0, MAX_WARNINGS)
    : [];
  // Defensive: if the model said ok=false but emitted no warnings, treat
  // it as ok=true for ATTENDED callers — we can't show a modal with no
  // content; an empty-warning modal is worse UX than a missed flag. For
  // the unattended path there is no modal: the model's not-ok verdict
  // stands and the draft is held.
  if (!ok && warnings.length === 0) {
    if (failMode === "closed") {
      return { ok: false, warnings: [] };
    }
    return { ok: true, warnings: [] };
  }
  return { ok: warnings.length === 0, warnings };
}

// engineer-39 — typed error thrown from approveAgentDraftAction when
// the pre-send check returns ok=false. The inbox detail page catches
// this on the client (DraftActions component) and renders the
// PreSendWarningModal. The error name is the discriminator since
// `instanceof` doesn't survive the server→client boundary in Next.js
// server actions.
export const PRE_SEND_CHECK_ERROR_NAME = "PreSendCheckFailedError";

export class PreSendCheckFailedError extends Error {
  name = PRE_SEND_CHECK_ERROR_NAME;
  warnings: PreSendWarning[];
  constructor(warnings: PreSendWarning[]) {
    super("PRE_SEND_CHECK_FAILED");
    this.warnings = warnings;
  }
}
