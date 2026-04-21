import "server-only";

// In-memory token bucket keyed by `${bucket}:${userId}`. Good enough for α
// (≤10 users, single Vercel region). When we scale to multiple regions or
// serverless instances drift, move to Upstash/Redis — the API of
// `enforceRateLimit` stays the same.

export class RateLimitError extends Error {
  code = "RATE_LIMITED" as const;
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded.");
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export type BucketConfig = {
  capacity: number;
  refillPerSec: number;
};

type BucketState = { tokens: number; updatedAtMs: number };

const store = new Map<string, BucketState>();

// Exposed for tests.
export function __resetRateLimitStore(): void {
  store.clear();
}

export function tryConsume(
  key: string,
  config: BucketConfig,
  nowMs: number = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const existing = store.get(key);
  const tokens = existing
    ? Math.min(
        config.capacity,
        existing.tokens +
          ((nowMs - existing.updatedAtMs) / 1000) * config.refillPerSec
      )
    : config.capacity;

  if (tokens >= 1) {
    store.set(key, { tokens: tokens - 1, updatedAtMs: nowMs });
    return { ok: true };
  }

  const deficit = 1 - tokens;
  const retryAfterSeconds = deficit / config.refillPerSec;
  store.set(key, { tokens, updatedAtMs: nowMs });
  return { ok: false, retryAfterSeconds };
}

export function enforceRateLimit(
  userId: string,
  bucket: string,
  config: BucketConfig
): void {
  const result = tryConsume(`${bucket}:${userId}`, config);
  if (!result.ok) throw new RateLimitError(result.retryAfterSeconds);
}

// Preset buckets for the α OpenAI-hitting endpoints. Tune via env later.
export const BUCKETS = {
  chatMessage: { capacity: 20, refillPerSec: 20 / 60 },
  chatStream: { capacity: 20, refillPerSec: 20 / 60 },
  syllabusExtract: { capacity: 10, refillPerSec: 10 / 300 },
  chatAttachment: { capacity: 30, refillPerSec: 30 / 60 },
} as const satisfies Record<string, BucketConfig>;

export function rateLimitResponse(err: RateLimitError): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please wait a moment.",
      code: err.code,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(err.retryAfterSeconds),
      },
    }
  );
}
