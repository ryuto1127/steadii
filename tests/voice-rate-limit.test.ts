import { beforeEach, describe, expect, it } from "vitest";
import {
  BUCKETS,
  RateLimitError,
  __resetRateLimitStore,
  enforceRateLimit,
} from "@/lib/utils/rate-limit";

beforeEach(() => __resetRateLimitStore());

describe("voice rate limit bucket", () => {
  it("is configured for 60 calls/hour per user", () => {
    expect(BUCKETS.voice.capacity).toBe(60);
    // 60 / 3600 ≈ 0.01666; allow tiny floating-point slack.
    expect(BUCKETS.voice.refillPerSec).toBeCloseTo(60 / 3600);
  });

  it("allows the full capacity in a burst, then rejects the 61st call", () => {
    for (let i = 0; i < 60; i++) {
      expect(() =>
        enforceRateLimit("u-voice", "voice", BUCKETS.voice)
      ).not.toThrow();
    }
    expect(() =>
      enforceRateLimit("u-voice", "voice", BUCKETS.voice)
    ).toThrow(RateLimitError);
  });

  it("buckets are scoped per user — a different userId starts fresh", () => {
    for (let i = 0; i < 60; i++)
      enforceRateLimit("u-a", "voice", BUCKETS.voice);
    expect(() =>
      enforceRateLimit("u-a", "voice", BUCKETS.voice)
    ).toThrow(RateLimitError);
    // Distinct user gets their own 60-call budget.
    expect(() =>
      enforceRateLimit("u-b", "voice", BUCKETS.voice)
    ).not.toThrow();
  });
});
