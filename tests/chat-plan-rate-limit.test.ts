import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetRateLimitStore,
  CHAT_PLAN_LIMITS,
  chatBucketsFor,
  enforceChatLimits,
  RateLimitError,
} from "@/lib/utils/rate-limit";

beforeEach(() => {
  __resetRateLimitStore();
});

describe("chat per-plan limits (project_decisions.md)", () => {
  it("matches the published caps exactly", () => {
    expect(CHAT_PLAN_LIMITS.free).toEqual({ dailyCap: 15, hourlyCap: 5 });
    expect(CHAT_PLAN_LIMITS.student).toEqual({ dailyCap: 80, hourlyCap: 20 });
    expect(CHAT_PLAN_LIMITS.pro).toEqual({ dailyCap: 120, hourlyCap: 25 });
  });

  it("chatBucketsFor returns hourly refill = hourlyCap / 3600s", () => {
    const b = chatBucketsFor("free");
    expect(b.hourly.capacity).toBe(5);
    expect(b.hourly.refillPerSec).toBeCloseTo(5 / 3600, 10);
    expect(b.daily.capacity).toBe(15);
    expect(b.daily.refillPerSec).toBeCloseTo(15 / 86_400, 10);
  });

  it("Free user blocked after 5 messages in an hour (hourly cap)", () => {
    for (let i = 0; i < 5; i++) {
      enforceChatLimits("user_free", "free");
    }
    expect(() => enforceChatLimits("user_free", "free")).toThrow(RateLimitError);
  });

  it("Pro user allowed 25 messages before hourly cap hits", () => {
    for (let i = 0; i < 25; i++) {
      enforceChatLimits("user_pro", "pro");
    }
    expect(() => enforceChatLimits("user_pro", "pro")).toThrow(RateLimitError);
  });

  it("Student user sits between free and pro", () => {
    for (let i = 0; i < 20; i++) {
      enforceChatLimits("user_student", "student");
    }
    expect(() => enforceChatLimits("user_student", "student")).toThrow(
      RateLimitError
    );
  });

  it("Admin is effectively unlimited (10k)", () => {
    // Blast 200 — more than any real-world user would ever send — and
    // expect no throw for admin plan.
    expect(() => {
      for (let i = 0; i < 200; i++) enforceChatLimits("user_admin", "admin");
    }).not.toThrow();
  });

  it("per-user buckets are isolated", () => {
    for (let i = 0; i < 5; i++) enforceChatLimits("user_a", "free");
    // user_b hasn't sent anything, should still succeed on its first call.
    expect(() => enforceChatLimits("user_b", "free")).not.toThrow();
  });
});
