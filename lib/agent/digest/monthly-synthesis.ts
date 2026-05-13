import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { loadTopUserFacts } from "@/lib/agent/user-facts";
import type { MonthlyAggregate } from "./monthly-aggregation";
import {
  MONTHLY_SYNTHESIS_SCHEMA,
  MONTHLY_SYNTHESIS_SYSTEM_PROMPT,
  buildMonthlySynthesisUserContent,
} from "./prompts/monthly-synthesis-prompt";

// engineer-50 — Monthly digest synthesis layer.
//
// One LLM call per (user, month) — gpt-5.4 (complex tier) because
// quality > speed and the per-user-per-month frequency makes cost
// bounded. The aggregate is already pure data; this layer turns it
// into themes + recommendations + drift callouts.

export type MonthlySynthesisTheme = {
  title: string;
  body: string;
  evidence: Array<{
    kind:
      | "email_thread"
      | "assignment"
      | "event"
      | "chat_session"
      | "proactive_proposal";
    id: string;
    label: string;
  }>;
};

export type MonthlySynthesisRecommendation = {
  action: string;
  why: string;
  suggestedDate?: string | null;
};

export type MonthlySynthesisDriftCallout = {
  callout: string;
  severity: "info" | "warn" | "high";
};

export type MonthlySynthesis = {
  oneLineSummary: string;
  themes: MonthlySynthesisTheme[];
  recommendations: MonthlySynthesisRecommendation[];
  driftCallouts: MonthlySynthesisDriftCallout[];
};

export type MonthlySynthesisArgs = {
  userId: string;
  locale: "en" | "ja";
  monthLabel: string;
  aggregate: MonthlyAggregate;
  // When supplied, the synthesis prompt is asked to compare current
  // patterns to prior. The cron pulls the prior row's `synthesis` JSON
  // and hands it in; the aggregator's own `comparisons.priorMonth`
  // remains the structured delta source.
  priorSynthesis: MonthlySynthesis | null;
};

export type SynthesizeResult = {
  synthesis: MonthlySynthesis;
  usageId: string | null;
};

// Hard-coded fallback when the LLM call fails or the response can't be
// parsed. The cron persists this so the user still sees something on
// the digest page rather than a 404 — but the email send path can
// inspect `themes.length === 0` to suppress the dispatch.
const EMPTY_SYNTHESIS: MonthlySynthesis = {
  oneLineSummary: "",
  themes: [],
  recommendations: [],
  driftCallouts: [],
};

export async function synthesizeMonthlyDigest(
  args: MonthlySynthesisArgs
): Promise<SynthesizeResult> {
  const userFacts = await loadTopUserFacts(args.userId);

  return Sentry.startSpan(
    {
      name: "agent.digest.monthly_synthesis",
      op: "llm",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.task_type": "monthly_digest_synthesis",
      },
    },
    async () => {
      const model = selectModel("syllabus_extract");
      const userContent = buildMonthlySynthesisUserContent({
        locale: args.locale,
        monthLabel: args.monthLabel,
        aggregate: args.aggregate,
        userFacts,
        priorSynthesis: args.priorSynthesis,
      });

      try {
        const resp = await openai().chat.completions.create({
          model,
          messages: [
            { role: "system", content: MONTHLY_SYNTHESIS_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "monthly_digest_synthesis",
              strict: false,
              schema: MONTHLY_SYNTHESIS_SCHEMA,
            },
          },
        });

        const rec = await recordUsage({
          userId: args.userId,
          model,
          // Monthly synthesis routes through the complex tier; reuse
          // `syllabus_extract` as the task-type label because the
          // selectModel router maps it to the same tier and the credit
          // metering treats it as a paid task. A dedicated TaskType is
          // worth adding once monthly-digest volume exceeds α scale.
          taskType: "syllabus_extract",
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
          cachedTokens:
            (
              resp.usage as {
                prompt_tokens_details?: { cached_tokens?: number };
              }
            )?.prompt_tokens_details?.cached_tokens ?? 0,
        });

        const content = resp.choices[0]?.message?.content ?? "{}";
        const parsed = parseSynthesisResponse(content);
        if (!parsed) {
          return { synthesis: EMPTY_SYNTHESIS, usageId: rec.usageId };
        }
        return { synthesis: parsed, usageId: rec.usageId };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "monthly_digest_synthesis" },
          user: { id: args.userId },
        });
        return { synthesis: EMPTY_SYNTHESIS, usageId: null };
      }
    }
  );
}

// Parse + validate. Returns null on parse / shape failure so the caller
// can fall back to EMPTY_SYNTHESIS. Defensive over the LLM's structured
// output — even with response_format json_schema, occasional gpt-5.4
// edge-cases yield extra keys or wrong types.
export function parseSynthesisResponse(raw: string): MonthlySynthesis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const oneLineSummary =
    typeof obj.oneLineSummary === "string" ? obj.oneLineSummary : "";
  const themes = Array.isArray(obj.themes)
    ? obj.themes.map(asTheme).filter((t): t is MonthlySynthesisTheme => t !== null)
    : [];
  const recommendations = Array.isArray(obj.recommendations)
    ? obj.recommendations
        .map(asRecommendation)
        .filter((r): r is MonthlySynthesisRecommendation => r !== null)
    : [];
  const driftCallouts = Array.isArray(obj.driftCallouts)
    ? obj.driftCallouts
        .map(asDriftCallout)
        .filter((d): d is MonthlySynthesisDriftCallout => d !== null)
    : [];

  return {
    oneLineSummary,
    themes,
    recommendations,
    driftCallouts,
  };
}

function asTheme(v: unknown): MonthlySynthesisTheme | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== "string" || typeof o.body !== "string") return null;
  const evidence = Array.isArray(o.evidence)
    ? o.evidence
        .map(asEvidence)
        .filter((e): e is MonthlySynthesisTheme["evidence"][number] => e !== null)
    : [];
  return { title: o.title, body: o.body, evidence };
}

function asEvidence(
  v: unknown
): MonthlySynthesisTheme["evidence"][number] | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.label !== "string" ||
    typeof o.kind !== "string"
  )
    return null;
  if (
    !["email_thread", "assignment", "event", "chat_session", "proactive_proposal"].includes(
      o.kind
    )
  )
    return null;
  return {
    kind: o.kind as MonthlySynthesisTheme["evidence"][number]["kind"],
    id: o.id,
    label: o.label,
  };
}

function asRecommendation(v: unknown): MonthlySynthesisRecommendation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.action !== "string" || typeof o.why !== "string") return null;
  const suggestedDate =
    typeof o.suggestedDate === "string" ? o.suggestedDate : null;
  return { action: o.action, why: o.why, suggestedDate };
}

function asDriftCallout(v: unknown): MonthlySynthesisDriftCallout | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.callout !== "string") return null;
  const sev = typeof o.severity === "string" ? o.severity : "info";
  if (!["info", "warn", "high"].includes(sev)) return null;
  return {
    callout: o.callout,
    severity: sev as MonthlySynthesisDriftCallout["severity"],
  };
}
