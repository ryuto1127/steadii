import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";

// engineer-48 — second-pass reranker over fanout's cosine-recall slate.
//
// First-pass cosine retrieval (lib/agent/email/retrieval.ts +
// loadVectorSyllabusChunks in fanout.ts) is wide: top-20 similar emails
// or top-K syllabus chunks. RAG literature (mem0 / Cohere reranker
// papers / 2024 LangChain reranker eval) consistently shows that ~half
// the recall set is off-topic at this stage and a second-pass scoring
// model gives a 20-40% precision lift for similar token budgets.
//
// Architecture: one LLM call (mini tier) per fanout phase that scores
// each candidate 0..1 against the query. Strict-JSON output keeps the
// shape stable. Fail-soft: any error returns the candidates unchanged
// with score=null so the pipeline never blocks on the reranker.

export type RerankerCandidate = {
  id: string;
  text: string;
  sourceType: "similar_email" | "syllabus_chunk" | "calendar_event" | "other";
};

export type RerankerInput = {
  userId: string;
  query: string;
  candidates: RerankerCandidate[];
  topK: number;
};

export type RerankedCandidate = {
  id: string;
  score: number | null;
  reasoning: string | null;
};

export type RerankerOutput = {
  ranked: RerankedCandidate[];
  // Surface counts for the audit log without forcing the caller to
  // recompute them. `failed=true` when the LLM call threw and we
  // fell back to the pass-through behavior.
  beforeCount: number;
  afterCount: number;
  failed: boolean;
  usageId: string | null;
};

// 30 candidates is the empirical ceiling where the score JSON still
// fits comfortably in the mini tier's 4k output budget. Beyond this
// we'd start truncating the response.
const MAX_RERANK_CANDIDATES = 30;

// Truncate per-candidate text so the prompt stays bounded. The reranker
// scores topical relevance from a short representation; full-body
// scoring would be wasted tokens given that classify/draft already
// re-reads the survivors.
const PER_CANDIDATE_CHAR_LIMIT = 300;

const SYSTEM_PROMPT = `You are Steadii's retrieval reranker. Given a QUERY and a list of CANDIDATES retrieved by cosine similarity, score each candidate 0..1 on how directly relevant it is to answering / responding to the query.

Scoring scale:
- 0.0-0.3: not relevant. Different topic, unrelated sender, or generic content the query doesn't need.
- 0.3-0.5: tangentially related. Same general area but doesn't help respond to this specific query.
- 0.5-0.7: useful context. Related thread or topic, would inform the response.
- 0.7-1.0: highly relevant. Direct match — same thread, same question, or contains the answer.

Be strict. Most candidates should be < 0.5. A wide recall set always has a long tail of false-positives; your job is to surface the actual signal.

Output the JSON schema you're given: for each candidate id, an entry with the score and one short reasoning sentence (≤ 30 words, English). Order doesn't matter — the caller sorts by score desc.`;

const RERANK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 1 },
          reasoning: { type: "string", maxLength: 200 },
        },
        required: ["id", "score", "reasoning"],
      },
    },
  },
  required: ["ranked"],
} as const;

export async function rerank(
  input: RerankerInput
): Promise<RerankerOutput> {
  return Sentry.startSpan(
    {
      name: "email.retrieval.rerank",
      op: "gen_ai.rerank",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.candidates": input.candidates.length,
      },
    },
    async () => runRerank(input)
  );
}

async function runRerank(input: RerankerInput): Promise<RerankerOutput> {
  const beforeCount = input.candidates.length;

  // Trivial cases — no LLM call needed.
  if (beforeCount === 0) {
    return {
      ranked: [],
      beforeCount: 0,
      afterCount: 0,
      failed: false,
      usageId: null,
    };
  }
  if (beforeCount === 1) {
    return {
      ranked: [{ id: input.candidates[0].id, score: 1, reasoning: null }],
      beforeCount: 1,
      afterCount: 1,
      failed: false,
      usageId: null,
    };
  }

  // Cap candidates to keep the JSON output bounded. The pre-cap
  // candidates pass through with null score so the caller still has
  // them in deterministic order; we don't drop them silently.
  const scored = input.candidates.slice(0, MAX_RERANK_CANDIDATES);
  const unscored = input.candidates.slice(MAX_RERANK_CANDIDATES);

  const userContent = buildUserContent(input.query, scored);
  const model = selectModel("rerank");

  try {
    const resp = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rerank",
          strict: true,
          schema: RERANK_JSON_SCHEMA,
        },
      },
    });

    const rec = await recordUsage({
      userId: input.userId,
      model,
      taskType: "rerank",
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      cachedTokens:
        (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
          ?.prompt_tokens_details?.cached_tokens ?? 0,
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = parseRerankOutput(raw, scored);

    // Map back to canonical order then top-K. Unscored tail (if any)
    // appends with score=null so it doesn't get dropped from the
    // caller's view — but it sorts below scored items via the sort
    // comparator below.
    const merged: RerankedCandidate[] = [
      ...parsed,
      ...unscored.map((c) => ({ id: c.id, score: null, reasoning: null })),
    ];
    merged.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const top = merged.slice(0, input.topK);

    return {
      ranked: top,
      beforeCount,
      afterCount: top.length,
      failed: false,
      usageId: rec.usageId,
    };
  } catch (err) {
    Sentry.captureException(err, {
      level: "warning",
      tags: { feature: "retrieval_rerank" },
      user: { id: input.userId },
    });
    // Fail-soft: return candidates unchanged so the caller can degrade
    // to pre-reranker behavior without surfacing the error.
    return {
      ranked: input.candidates.slice(0, input.topK).map((c) => ({
        id: c.id,
        score: null,
        reasoning: null,
      })),
      beforeCount,
      afterCount: Math.min(beforeCount, input.topK),
      failed: true,
      usageId: null,
    };
  }
}

function buildUserContent(
  query: string,
  candidates: RerankerCandidate[]
): string {
  const lines: string[] = [];
  lines.push("QUERY:");
  lines.push(query.slice(0, 1500));
  lines.push("");
  lines.push("CANDIDATES:");
  for (const c of candidates) {
    const text = c.text.slice(0, PER_CANDIDATE_CHAR_LIMIT).replace(/\s+/g, " ");
    lines.push(`[id=${c.id}] (${c.sourceType}) ${text}`);
  }
  return lines.join("\n");
}

export function parseRerankOutput(
  raw: string,
  scored: RerankerCandidate[]
): RerankedCandidate[] {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = { ranked: [] };
  }
  const r = (j as { ranked?: unknown }).ranked;
  if (!Array.isArray(r)) {
    // Shape failure — fall back to assigning a neutral score for every
    // input candidate so the pipeline still progresses.
    return scored.map((c) => ({ id: c.id, score: 0.5, reasoning: null }));
  }
  // Lookup table so we can pin the score onto the candidate's original id
  // and tolerate the LLM emitting either id or a paraphrased id.
  const byId = new Map(scored.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: RerankedCandidate[] = [];
  for (const item of r) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id || !byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    const score =
      typeof o.score === "number" && o.score >= 0 && o.score <= 1
        ? o.score
        : 0.5;
    const reasoning =
      typeof o.reasoning === "string" && o.reasoning.trim().length > 0
        ? o.reasoning.trim()
        : null;
    out.push({ id, score, reasoning });
  }
  // Any candidate the model omitted gets a neutral mid-score so it
  // doesn't get silently dropped to the bottom.
  for (const c of scored) {
    if (!seen.has(c.id)) {
      out.push({ id: c.id, score: 0.5, reasoning: null });
    }
  }
  return out;
}
