import "server-only";

import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";

// Generate a single-use Stripe Promotion Code under the
// STEADII_FRIEND_3MO coupon. Code shape: STEADII-{SLUG}, where SLUG is
// derived from the user's name (preferred) or email local-part. Pure
// ASCII upper-case + digits + hyphens — Stripe rejects anything else
// (we previously shipped a Greek "α" in the literal which 400'd every
// create call; see Layer 2 below for the detector hardening that
// caught it).
//
// Stripe rejects duplicate Promotion Code strings, so on collision we
// retry with a numeric suffix until a free slot opens up.

export type PromotionCodeResult = {
  code: string;
  promotionCodeId: string;
};

export async function createWaitlistPromotionCode(args: {
  email: string;
  name: string | null;
}): Promise<PromotionCodeResult> {
  const couponId = env().STRIPE_COUPON_FRIEND_3MO;
  if (!couponId) {
    throw new Error(
      "STRIPE_COUPON_FRIEND_3MO is not set — run scripts/stripe-setup.ts."
    );
  }

  const baseSlug = slugFor(args.name, args.email);
  const baseCode = `STEADII-${baseSlug}`;

  // Try the bare code, then -2, -3, … up to a small ceiling. The
  // collision rate at α scale is ~0; the loop just keeps the action
  // idempotent if Ryuto re-approves an already-coded request manually.
  for (let suffix = 0; suffix < 50; suffix++) {
    const code = suffix === 0 ? baseCode : `${baseCode}-${suffix + 1}`;
    try {
      const created = await stripe().promotionCodes.create({
        promotion: { type: "coupon", coupon: couponId },
        code,
        max_redemptions: 1,
        metadata: {
          source: "waitlist",
          email: args.email,
        },
      });
      return { code, promotionCodeId: created.id };
    } catch (err) {
      if (isPromotionCodeCollision(err)) continue;
      throw err;
    }
  }

  throw new Error(
    `Could not create a unique Stripe Promotion Code for ${args.email} after 50 attempts.`
  );
}

function slugFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "FRIEND";
  const ascii = source
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "FRIEND";
}

// Stripe surfaces "code already exists" as a StripeInvalidRequestError
// whose message text contains "already exists" / "already in use" /
// "duplicate". Match on the message — NOT on `param: 'code'` — because
// character-validation errors (e.g. a non-ASCII char snuck into the
// literal) also carry `param: 'code'` and would otherwise be swallowed
// as collisions, looping the suffix retry until the 50-attempt ceiling
// blew up. Real-prod incident 2026-04-29.
function isPromotionCodeCollision(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    type?: string;
    code?: string;
    message?: string;
  };
  if (e.type !== "StripeInvalidRequestError") return false;
  return (
    typeof e.message === "string" &&
    /already exist|already in use|duplicate/i.test(e.message)
  );
}
