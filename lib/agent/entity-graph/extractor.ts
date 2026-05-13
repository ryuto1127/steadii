import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { EntityKind } from "@/lib/db/schema";

// engineer-51 — extract candidate entities from a single source row's
// text representation. One LLM call per source. Mini tier; structured
// JSON output keeps the shape stable. Fail-soft: returns [] on any
// parser / network / shape failure so the resolver can continue without
// blocking the primary ingest path.

export type EntityCandidate = {
  kind: EntityKind;
  displayName: string;
  aliases?: string[];
};

// Cap the source-text passed to the extractor. Mini tier is cheap but
// nothing in an email body past the first 2k chars meaningfully
// changes which entities matter — and the prompt budget is also bounded
// downstream by the embedding step.
const EXTRACTOR_INPUT_MAX_CHARS = 2400;

// Cap candidates per call. A single email rarely mentions more than 3-4
// useful entities; anything past that is almost always noise (cc'd
// addresses, marketing copy, etc.).
const MAX_CANDIDATES_PER_CALL = 6;

const SYSTEM_PROMPT = `You extract NAMED ENTITIES from a user's email / calendar / assignment / chat text. These entities become navigation hubs that cross-link the user's data ("everything about project X", "all emails from professor Y").

Entity kinds:
- person: a specific human (professor, classmate, recruiter, club friend, family). Use the actual name, not the role.
- project: a body of work spanning multiple touchpoints (interview process, group project, club initiative, research collaboration). Don't include one-off tasks.
- course: a university class. Use the course name OR code (e.g. "MAT223", "Introduction to Linear Algebra").
- org: a company, university, club, lab, association (e.g. "令和トラベル", "UToronto", "Anthropic", "Robotics Club").
- event_series: a recurring event (e.g. "Tuesday TA hours", "weekly study group"). NOT one-off events.

Rules:
- Only return entities that would be useful as a NAVIGATION HUB. Pass on one-off mentions, casual references, signature lines, and CC'd addresses unless they're clearly the focus.
- Use the canonical short name as displayName. If the text shows abbreviations or alternate spellings, list them under aliases.
- For person kind, the displayName is the human's name (not "Prof. Smith" — just "John Smith" if known, or "Smith" if only surname is available).
- Be precise. Empty list is a valid answer — most short texts have nothing notable.
- Maximum ${MAX_CANDIDATES_PER_CALL} entities per response.

Output JSON matching the schema. Reasoning is optional; the score field doesn't exist for this task.`;

const EXTRACTOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["person", "project", "course", "org", "event_series"],
          },
          displayName: { type: "string", minLength: 1, maxLength: 120 },
          aliases: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
        required: ["kind", "displayName", "aliases"],
      },
    },
  },
  required: ["entities"],
} as const;

export async function extractEntityCandidates(args: {
  userId: string;
  text: string;
  // Optional hint to the model about what role this text plays in the
  // user's life — biases extraction for short / context-free inputs.
  sourceHint?: string;
}): Promise<EntityCandidate[]> {
  const text = args.text.slice(0, EXTRACTOR_INPUT_MAX_CHARS).trim();
  if (!text) return [];

  return Sentry.startSpan(
    {
      name: "entity_graph.extract",
      op: "gen_ai.classify",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.input_chars": text.length,
      },
    },
    async () => {
      const model = selectModel("tool_call");
      try {
        const resp = await openai().chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: args.sourceHint
                ? `Source: ${args.sourceHint}\n\nText:\n${text}`
                : text,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "entity_extract",
              strict: true,
              schema: EXTRACTOR_JSON_SCHEMA,
            },
          },
        });

        await recordUsage({
          userId: args.userId,
          model,
          taskType: "tool_call",
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
          cachedTokens:
            (
              resp.usage as {
                prompt_tokens_details?: { cached_tokens?: number };
              }
            )?.prompt_tokens_details?.cached_tokens ?? 0,
        });

        const raw = resp.choices[0]?.message?.content ?? "{}";
        return parseExtractorOutput(raw);
      } catch (err) {
        Sentry.captureException(err, {
          level: "warning",
          tags: { feature: "entity_graph", phase: "extract" },
          user: { id: args.userId },
        });
        return [];
      }
    }
  );
}

export function parseExtractorOutput(raw: string): EntityCandidate[] {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  const e = (j as { entities?: unknown }).entities;
  if (!Array.isArray(e)) return [];
  const out: EntityCandidate[] = [];
  for (const item of e) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind;
    const displayName = o.displayName;
    if (typeof displayName !== "string" || !displayName.trim()) continue;
    if (
      kind !== "person" &&
      kind !== "project" &&
      kind !== "course" &&
      kind !== "org" &&
      kind !== "event_series"
    ) {
      continue;
    }
    const aliases = Array.isArray(o.aliases)
      ? (o.aliases.filter(
          (a) => typeof a === "string" && a.trim().length > 0
        ) as string[])
      : [];
    out.push({
      kind,
      displayName: displayName.trim().slice(0, 120),
      aliases: aliases.map((a) => a.trim().slice(0, 80)),
    });
    if (out.length >= MAX_CANDIDATES_PER_CALL) break;
  }
  return out;
}
