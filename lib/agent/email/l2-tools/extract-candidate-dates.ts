import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { L2ToolExecutor } from "./types";

// engineer-41 — extract structured candidate dates from an email body.
//
// Date formats in the real world are too varied for regex (JP "2026/5/15
// (金) 10:00 〜 11:00" vs "May 15 @ 10am EST" vs "Friday at 10"). We use
// mini for parsing; mini handles structured short-form well at ~1/5 the
// cost of full. The tool returns an empty array when no dates are found,
// which the orchestrator treats as "this email isn't about scheduling".

export type CandidateDate = {
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm 24h
  endTime: string | null; // HH:mm 24h
  timezoneHint: string | null; // "JST", "America/New_York", "(金)", etc.
  confidence: number; // 0..1
  sourceText: string; // verbatim slice of the email this came from
};

export type ExtractCandidateDatesArgs = {
  body: string;
};

export type ExtractCandidateDatesResult = {
  candidates: CandidateDate[];
};

const SYSTEM_PROMPT = `You extract candidate meeting/event dates from an email body for a scheduling agent.

Return a JSON array of candidates. Each candidate is one specific date the email proposes, mentions as a slot to pick from, or sets as a deadline. Do NOT include vague references ("sometime next week", "soon").

Rules:
- date is always YYYY-MM-DD. If the year is implicit, infer from context (current year unless month is before today, in which case next year).
- startTime / endTime are HH:mm 24h. Null when only a date is given.
- timezoneHint preserves any explicit marker found in the source: "JST", "EST", "(金)", "PT", "Asia/Tokyo", etc. Null when no marker.
- confidence is 0..1. 0.95+ for explicit unambiguous dates ("2026/5/15 10:00-11:00 JST"); 0.7-0.85 for relative dates ("Friday at 10"); below 0.6 → omit.
- sourceText is the literal substring of the email body that produced this candidate. Trim whitespace; keep ≤120 chars.

If no candidates: return { "candidates": [] }. Don't pad.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", minLength: 10, maxLength: 10 },
          startTime: { type: ["string", "null"] },
          endTime: { type: ["string", "null"] },
          timezoneHint: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceText: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: [
          "date",
          "startTime",
          "endTime",
          "timezoneHint",
          "confidence",
          "sourceText",
        ],
      },
    },
  },
  required: ["candidates"],
} as const;

export const extractCandidateDatesTool: L2ToolExecutor<
  ExtractCandidateDatesArgs,
  ExtractCandidateDatesResult
> = {
  schema: {
    name: "extract_candidate_dates",
    description:
      "Parse the email body for structured candidate dates (proposed slots, deadlines, specific times). Returns date, start/end time, timezone hint, confidence, and the verbatim source text per candidate. Returns an empty array when no concrete dates are mentioned — use this to decide whether the email is scheduling-related at all.",
    parameters: {
      type: "object",
      properties: {
        body: { type: "string", minLength: 1 },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    if (!args.body || args.body.trim().length === 0) {
      return { candidates: [] };
    }
    const model = selectModel("email_classify_risk"); // mini
    const resp = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: args.body.slice(0, 8000) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extract_candidate_dates",
          strict: true,
          schema: SCHEMA,
        },
      },
    });
    await recordUsage({
      userId: ctx.userId,
      model,
      taskType: "email_classify_risk",
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      cachedTokens:
        (resp.usage as {
          prompt_tokens_details?: { cached_tokens?: number };
        })?.prompt_tokens_details?.cached_tokens ?? 0,
    });
    return parseExtractCandidateDatesOutput(
      resp.choices[0]?.message?.content ?? "{}"
    );
  },
};

export function parseExtractCandidateDatesOutput(
  raw: string
): ExtractCandidateDatesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { candidates: [] };
  }
  const o = (parsed ?? {}) as { candidates?: unknown };
  if (!Array.isArray(o.candidates)) return { candidates: [] };
  const out: CandidateDate[] = [];
  for (const item of o.candidates) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const date =
      typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())
        ? r.date.trim()
        : null;
    if (!date) continue;
    const startTime =
      typeof r.startTime === "string" && /^\d{2}:\d{2}$/.test(r.startTime)
        ? r.startTime
        : null;
    const endTime =
      typeof r.endTime === "string" && /^\d{2}:\d{2}$/.test(r.endTime)
        ? r.endTime
        : null;
    const timezoneHint =
      typeof r.timezoneHint === "string" && r.timezoneHint.trim().length > 0
        ? r.timezoneHint.trim().slice(0, 60)
        : null;
    const confidence = Math.max(
      0,
      Math.min(1, typeof r.confidence === "number" ? r.confidence : 0)
    );
    if (confidence < 0.6) continue;
    const sourceText =
      typeof r.sourceText === "string"
        ? r.sourceText.trim().slice(0, 200)
        : "";
    out.push({ date, startTime, endTime, timezoneHint, confidence, sourceText });
  }
  return { candidates: out };
}
