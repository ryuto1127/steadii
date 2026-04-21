import { describe, expect, it, beforeEach } from "vitest";
import {
  RateLimitError,
  __resetRateLimitStore,
  enforceRateLimit,
  tryConsume,
} from "@/lib/utils/rate-limit";

beforeEach(() => __resetRateLimitStore());

describe("token bucket", () => {
  it("allows up to capacity in a burst", () => {
    const cfg = { capacity: 3, refillPerSec: 1 };
    expect(tryConsume("k", cfg, 0).ok).toBe(true);
    expect(tryConsume("k", cfg, 0).ok).toBe(true);
    expect(tryConsume("k", cfg, 0).ok).toBe(true);
    const blocked = tryConsume("k", cfg, 0);
    expect(blocked.ok).toBe(false);
  });

  it("refills over time", () => {
    const cfg = { capacity: 2, refillPerSec: 1 };
    tryConsume("k", cfg, 0);
    tryConsume("k", cfg, 0);
    expect(tryConsume("k", cfg, 0).ok).toBe(false);
    // 2 seconds later, ~2 tokens have refilled — next consume passes.
    expect(tryConsume("k", cfg, 2000).ok).toBe(true);
  });

  it("reports a positive retry-after when blocked", () => {
    const cfg = { capacity: 1, refillPerSec: 0.1 };
    tryConsume("k", cfg, 0);
    const r = tryConsume("k", cfg, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfterSeconds).toBeGreaterThan(0);
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(10);
    }
  });

  it("keys buckets independently", () => {
    const cfg = { capacity: 1, refillPerSec: 0.1 };
    expect(tryConsume("a", cfg, 0).ok).toBe(true);
    expect(tryConsume("a", cfg, 0).ok).toBe(false);
    expect(tryConsume("b", cfg, 0).ok).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("throws RateLimitError when exceeded", () => {
    const cfg = { capacity: 1, refillPerSec: 0.1 };
    enforceRateLimit("u", "b", cfg);
    expect(() => enforceRateLimit("u", "b", cfg)).toThrow(RateLimitError);
  });

  it("RateLimitError exposes integer retry-after ≥ 1", () => {
    const cfg = { capacity: 1, refillPerSec: 10 };
    enforceRateLimit("u", "b", cfg);
    try {
      enforceRateLimit("u", "b", cfg);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      if (err instanceof RateLimitError) {
        expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(err.retryAfterSeconds)).toBe(true);
      }
    }
  });

  it("different userIds are isolated", () => {
    const cfg = { capacity: 1, refillPerSec: 0.1 };
    enforceRateLimit("alice", "b", cfg);
    expect(() => enforceRateLimit("alice", "b", cfg)).toThrow(RateLimitError);
    enforceRateLimit("bob", "b", cfg);
  });
});
