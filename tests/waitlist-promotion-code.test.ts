import { describe, expect, it, beforeEach, vi } from "vitest";

// Hoisted state lets each test program the next promotionCodes.create()
// call: succeed with an id, or throw a specific Stripe-shaped error. We
// also record every code argument so tests can assert the suffix retry
// path produces "STEADII-FOO", "STEADII-FOO-2", "STEADII-FOO-3", etc.
const hoist = vi.hoisted(() => {
  type Outcome =
    | { kind: "ok"; id: string }
    | { kind: "throw"; err: unknown };
  const state = {
    queue: [] as Outcome[],
    seenCodes: [] as string[],
  };
  return { state };
});

vi.mock("@/lib/billing/stripe", () => ({
  stripe: () => ({
    promotionCodes: {
      create: async (args: { code: string }) => {
        hoist.state.seenCodes.push(args.code);
        const next = hoist.state.queue.shift();
        if (!next) throw new Error("test queue empty");
        if (next.kind === "throw") throw next.err;
        return { id: next.id };
      },
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ STRIPE_COUPON_FRIEND_3MO: "coupon_test" }),
}));

import { createWaitlistPromotionCode } from "@/lib/waitlist/promotion-code";

beforeEach(() => {
  hoist.state.queue = [];
  hoist.state.seenCodes = [];
});

describe("createWaitlistPromotionCode — code shape", () => {
  it("emits STEADII-{SLUG} with no Greek alpha", async () => {
    hoist.state.queue.push({ kind: "ok", id: "promo_1" });
    const result = await createWaitlistPromotionCode({
      email: "admin-alt@example.com",
      name: null,
    });
    expect(result.code).toBe("STEADII-SAMPLE");
    expect(result.code).not.toMatch(/α/);
    expect(result.promotionCodeId).toBe("promo_1");
  });

  it("uses name slug when provided", async () => {
    hoist.state.queue.push({ kind: "ok", id: "promo_2" });
    const result = await createWaitlistPromotionCode({
      email: "tanaka@example.com",
      name: "Tanaka Hiroshi",
    });
    expect(result.code).toBe("STEADII-TANAKA-HIROSHI");
  });

  it("falls back to FRIEND when slug strips to empty (non-ASCII name + non-ASCII local-part)", async () => {
    hoist.state.queue.push({ kind: "ok", id: "promo_3" });
    const result = await createWaitlistPromotionCode({
      email: "田中@example.com",
      name: "田中",
    });
    expect(result.code).toBe("STEADII-FRIEND");
  });
});

describe("createWaitlistPromotionCode — collision detection", () => {
  it("retries with -2, -3 suffix on real 'already exists' collisions", async () => {
    const collision = (msg: string) => {
      const e = new Error(msg) as Error & { type?: string; param?: string };
      e.type = "StripeInvalidRequestError";
      e.param = "code";
      return e;
    };
    hoist.state.queue.push({
      kind: "throw",
      err: collision("The promotion code already exists."),
    });
    hoist.state.queue.push({
      kind: "throw",
      err: collision("The promotion code already exists."),
    });
    hoist.state.queue.push({ kind: "ok", id: "promo_after_retry" });

    const result = await createWaitlistPromotionCode({
      email: "alice@example.com",
      name: null,
    });

    expect(hoist.state.seenCodes).toEqual([
      "STEADII-ALICE",
      "STEADII-ALICE-2",
      "STEADII-ALICE-3",
    ]);
    expect(result.code).toBe("STEADII-ALICE-3");
    expect(result.promotionCodeId).toBe("promo_after_retry");
  });

  it("throws immediately on character-validation errors instead of looping", async () => {
    // The pre-fix bug: Stripe rejects a bad character in the literal with
    // a 400 carrying `param: 'code'` but a *different* message. The old
    // detector matched only `param: 'code'` and looped 50 times. The new
    // detector requires "already exists" / "already in use" / "duplicate"
    // in the message text, so this surfaces immediately.
    const badChar = new Error(
      "Invalid characters in promotion code. Allowed: A-Z, 0-9, hyphen, underscore."
    ) as Error & { type?: string; param?: string };
    badChar.type = "StripeInvalidRequestError";
    badChar.param = "code";
    hoist.state.queue.push({ kind: "throw", err: badChar });

    await expect(
      createWaitlistPromotionCode({ email: "bob@example.com", name: null })
    ).rejects.toThrow(/Invalid characters/);

    // The retry loop must NOT have fired again — only the bare code was
    // attempted.
    expect(hoist.state.seenCodes).toEqual(["STEADII-BOB"]);
  });

  it("throws non-Stripe errors immediately (network, unknown shape, etc.)", async () => {
    hoist.state.queue.push({
      kind: "throw",
      err: new Error("ECONNRESET"),
    });
    await expect(
      createWaitlistPromotionCode({ email: "carol@example.com", name: null })
    ).rejects.toThrow(/ECONNRESET/);
    expect(hoist.state.seenCodes).toEqual(["STEADII-CAROL"]);
  });

  it("matches alternate Stripe collision phrasings (in_use / duplicate)", async () => {
    const inUse = new Error("Code is already in use.") as Error & {
      type?: string;
    };
    inUse.type = "StripeInvalidRequestError";
    const duplicate = new Error("duplicate code rejected.") as Error & {
      type?: string;
    };
    duplicate.type = "StripeInvalidRequestError";

    hoist.state.queue.push({ kind: "throw", err: inUse });
    hoist.state.queue.push({ kind: "throw", err: duplicate });
    hoist.state.queue.push({ kind: "ok", id: "promo_alt" });

    const result = await createWaitlistPromotionCode({
      email: "dave@example.com",
      name: null,
    });
    expect(result.code).toBe("STEADII-DAVE-3");
  });
});
