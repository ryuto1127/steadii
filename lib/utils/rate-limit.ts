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
// chatMessage / chatStream are the burst-protection layer (anti-spam /
// anti-abuse within a minute). On top of those, a plan-tier-aware pair of
// buckets — see CHAT_PLAN_LIMITS below — caps hourly and daily usage.
export const BUCKETS = {
  chatMessage: { capacity: 20, refillPerSec: 20 / 60 },
  chatStream: { capacity: 20, refillPerSec: 20 / 60 },
  syllabusExtract: { capacity: 10, refillPerSec: 10 / 300 },
  notesExtract: { capacity: 10, refillPerSec: 10 / 300 },
  chatAttachment: { capacity: 30, refillPerSec: 30 / 60 },
  // Public /request-access POST. Per-IP, 10 / hour. Burst-friendly (the
  // capacity is the full hour's quota) so legit retries don't trip on the
  // first refill tick.
  waitlistRequest: { capacity: 10, refillPerSec: 10 / 3600 },
  // Voice input pipeline (Whisper + GPT mini cleanup). 60 calls/hour =
  // ~1/min average — voice is cheap (~$0.0004/call) but we cap to prevent
  // runaway loops or scripted spam.
  voice: { capacity: 60, refillPerSec: 60 / 3600 },
} as const satisfies Record<string, BucketConfig>;

// Per-plan chat caps from project_decisions.md. Hourly + daily enforced
// together; the first to run dry blocks the request with a 429. Chat is NOT
// credit-metered — these limits are the *only* chat gate.
export type ChatPlanLimits = {
  dailyCap: number;
  hourlyCap: number;
};

export const CHAT_PLAN_LIMITS: Record<
  "free" | "student" | "pro" | "admin",
  ChatPlanLimits
> = {
  free: { dailyCap: 15, hourlyCap: 5 },
  student: { dailyCap: 80, hourlyCap: 20 },
  pro: { dailyCap: 120, hourlyCap: 25 },
  // Admins aren't rate-limited on chat — give them "effectively unlimited"
  // numbers so the same pipeline works without a conditional.
  admin: { dailyCap: 10_000, hourlyCap: 10_000 },
};

export function chatBucketsFor(plan: "free" | "student" | "pro" | "admin"): {
  hourly: BucketConfig;
  daily: BucketConfig;
} {
  const limits = CHAT_PLAN_LIMITS[plan];
  return {
    hourly: { capacity: limits.hourlyCap, refillPerSec: limits.hourlyCap / 3600 },
    daily: { capacity: limits.dailyCap, refillPerSec: limits.dailyCap / 86_400 },
  };
}

export function enforceChatLimits(
  userId: string,
  plan: "free" | "student" | "pro" | "admin"
): void {
  const { hourly, daily } = chatBucketsFor(plan);
  enforceRateLimit(userId, "chat.plan.hour", hourly);
  enforceRateLimit(userId, "chat.plan.day", daily);
}

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
