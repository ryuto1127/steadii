/**
 * scripts/stripe-setup.ts
 *
 * Idempotent Stripe catalog setup. Creates the Products, Prices, and Coupons
 * specified in memory/project_decisions.md (authoritative). Re-runs are safe:
 * existing objects are matched by `metadata.steadii_key` and reused.
 *
 * Operates in whichever mode the STRIPE_SECRET_KEY points at (test or live).
 * W1 usage is test mode only — live mode is a separate cutover at α launch.
 *
 * Usage:
 *   pnpm tsx scripts/stripe-setup.ts
 *
 * Output: prints the env var lines to paste into .env.local.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Stripe from "stripe";

type ProductSpec = {
  key: string;
  envVar: string;
  name: string;
  description: string;
  price: {
    // For USD prices `unitAmount` is cents. For JPY (zero-decimal currency)
    // it's whole yen — Stripe expects unit_amount in the smallest currency
    // subunit and JPY's smallest unit is the yen itself.
    unitAmount: number;
    currency: "usd" | "jpy";
    recurring?: { interval: "day" | "week" | "month" | "year"; intervalCount?: number };
  };
};

type CouponSpec = {
  key: string;
  envVar: string;
  id: string; // stable, human-readable coupon ID
  params: Stripe.CouponCreateParams;
};

const PRODUCTS: ProductSpec[] = [
  {
    key: "pro_monthly",
    envVar: "STRIPE_PRICE_PRO_MONTHLY",
    name: "Steadii Pro (monthly)",
    description: "Pro — $20/month, 1000 credits/month.",
    price: {
      unitAmount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    },
  },
  {
    key: "pro_yearly",
    envVar: "STRIPE_PRICE_PRO_YEARLY",
    name: "Steadii Pro (yearly)",
    description: "Pro — $192/year (20% off monthly), 1000 credits/month.",
    price: {
      unitAmount: 19200,
      currency: "usd",
      recurring: { interval: "year" },
    },
  },
  {
    key: "student_4mo",
    envVar: "STRIPE_PRICE_STUDENT_4MO",
    name: "Steadii Student (4-month)",
    description:
      "Student — $40 every 4 months (effective $10/mo), 1000 credits/month. Requires .edu verification.",
    price: {
      unitAmount: 4000,
      currency: "usd",
      recurring: { interval: "month", intervalCount: 4 },
    },
  },
  {
    key: "topup_500",
    envVar: "STRIPE_PRICE_TOPUP_500",
    name: "Steadii Top-up (+500 credits)",
    description: "One-time +500 credits. Expires 90 days after purchase.",
    price: { unitAmount: 1000, currency: "usd" },
  },
  {
    key: "topup_2000",
    envVar: "STRIPE_PRICE_TOPUP_2000",
    name: "Steadii Top-up (+2000 credits)",
    description: "One-time +2000 credits. Expires 90 days after purchase.",
    price: { unitAmount: 3000, currency: "usd" },
  },
  {
    key: "data_retention",
    envVar: "STRIPE_PRICE_DATA_RETENTION",
    name: "Steadii Extended Data Retention",
    description:
      "One-time $10 — extends post-cancel data retention from 120 days to 12 months.",
    price: { unitAmount: 1000, currency: "usd" },
  },

  // --- JPY catalog (Phase 7 / JP α). Anchors set in
  // memory/project_decisions.md (Market scope, 2026-04-25):
  //   Pro monthly        ¥3,000  (vs ChatGPT Plus ¥3,000)
  //   Pro yearly         ¥28,800 (20% off monthly)
  //   Student 4-month    ¥6,000  (effective ¥1,500/mo)
  //   Top-up +500        ¥1,500
  //   Top-up +2000       ¥4,500
  //   Data retention     ¥1,500
  // JPY is zero-decimal — unit_amount is whole yen, not subunits.
  {
    key: "pro_monthly_jpy",
    envVar: "STRIPE_PRICE_PRO_MONTHLY_JPY",
    name: "Steadii Pro (monthly, JPY)",
    description: "Pro — ¥3,000/月、月1,000クレジット。",
    price: {
      unitAmount: 3000,
      currency: "jpy",
      recurring: { interval: "month" },
    },
  },
  {
    key: "pro_yearly_jpy",
    envVar: "STRIPE_PRICE_PRO_YEARLY_JPY",
    name: "Steadii Pro (yearly, JPY)",
    description: "Pro — ¥28,800/年（月額より20%オフ）、月1,000クレジット。",
    price: {
      unitAmount: 28800,
      currency: "jpy",
      recurring: { interval: "year" },
    },
  },
  {
    key: "student_4mo_jpy",
    envVar: "STRIPE_PRICE_STUDENT_4MO_JPY",
    name: "Steadii Student (4-month, JPY)",
    description:
      "Student — 4ヶ月¥6,000（実質¥1,500/月）、月1,000クレジット。.ac.jp 等の認証が必要。",
    price: {
      unitAmount: 6000,
      currency: "jpy",
      recurring: { interval: "month", intervalCount: 4 },
    },
  },
  {
    key: "topup_500_jpy",
    envVar: "STRIPE_PRICE_TOPUP_500_JPY",
    name: "Steadii Top-up (+500 credits, JPY)",
    description: "+500クレジット（一括）。購入から90日で失効。",
    price: { unitAmount: 1500, currency: "jpy" },
  },
  {
    key: "topup_2000_jpy",
    envVar: "STRIPE_PRICE_TOPUP_2000_JPY",
    name: "Steadii Top-up (+2000 credits, JPY)",
    description: "+2000クレジット（一括）。購入から90日で失効。",
    price: { unitAmount: 4500, currency: "jpy" },
  },
  {
    key: "data_retention_jpy",
    envVar: "STRIPE_PRICE_DATA_RETENTION_JPY",
    name: "Steadii Extended Data Retention (JPY)",
    description:
      "¥1,500（一括）— 解約後のデータ保持期間を120日から12ヶ月へ延長。",
    price: { unitAmount: 1500, currency: "jpy" },
  },
];

const COUPONS: CouponSpec[] = [
  {
    key: "admin_forever",
    envVar: "STRIPE_COUPON_ADMIN",
    id: "STEADII_ADMIN_FOREVER",
    params: {
      id: "STEADII_ADMIN_FOREVER",
      name: "Steadii Admin — 100% off forever",
      percent_off: 100,
      duration: "forever",
      max_redemptions: 10,
      metadata: { steadii_key: "admin_forever" },
    },
  },
  {
    key: "friend_3mo",
    envVar: "STRIPE_COUPON_FRIEND_3MO",
    id: "STEADII_FRIEND_3MO",
    params: {
      id: "STEADII_FRIEND_3MO",
      name: "Steadii Friend — 100% off for 3 months",
      percent_off: 100,
      duration: "repeating",
      duration_in_months: 3,
      // Individual Promotion Codes (max_redemptions=1 each) are created later
      // from this coupon by the admin flow. The coupon itself has no overall
      // redemption cap.
      metadata: { steadii_key: "friend_3mo" },
    },
  },
];

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error("STRIPE_SECRET_KEY not set (check .env.local)");
    process.exit(2);
  }
  const stripe = new Stripe(secret);

  const outputLines: string[] = [];

  // --- Products + Prices ---
  for (const spec of PRODUCTS) {
    const priceId = await ensureProductAndPrice(stripe, spec);
    outputLines.push(`${spec.envVar}=${priceId}`);
  }

  // --- Coupons ---
  for (const spec of COUPONS) {
    const couponId = await ensureCoupon(stripe, spec);
    outputLines.push(`${spec.envVar}=${couponId}`);
  }

  console.log("\n=== paste into .env.local ===\n");
  for (const line of outputLines) console.log(line);
  console.log("\n=============================\n");
}

async function ensureProductAndPrice(
  stripe: Stripe,
  spec: ProductSpec
): Promise<string> {
  // Find existing Product by metadata.steadii_key.
  const existingProducts = await stripe.products.search({
    query: `metadata['steadii_key']:'${spec.key}'`,
  });
  let product = existingProducts.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: { steadii_key: spec.key },
    });
    console.log(`created product: ${spec.key} (${product.id})`);
  } else {
    console.log(`reused product:  ${spec.key} (${product.id})`);
  }

  // Find existing active Price with matching shape.
  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  });
  const match = prices.data.find((p) => priceMatchesSpec(p, spec));
  if (match) {
    console.log(`reused price:    ${spec.key} (${match.id})`);
    return match.id;
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: spec.price.currency,
    unit_amount: spec.price.unitAmount,
    recurring: spec.price.recurring
      ? {
          interval: spec.price.recurring.interval,
          interval_count: spec.price.recurring.intervalCount ?? 1,
        }
      : undefined,
    metadata: { steadii_key: spec.key },
  });
  console.log(`created price:   ${spec.key} (${price.id})`);
  return price.id;
}

function priceMatchesSpec(p: Stripe.Price, spec: ProductSpec): boolean {
  if (p.currency !== spec.price.currency) return false;
  if (p.unit_amount !== spec.price.unitAmount) return false;
  const wantsRecurring = !!spec.price.recurring;
  const isRecurring = !!p.recurring;
  if (wantsRecurring !== isRecurring) return false;
  if (wantsRecurring && spec.price.recurring && p.recurring) {
    if (p.recurring.interval !== spec.price.recurring.interval) return false;
    if (
      (p.recurring.interval_count ?? 1) !==
      (spec.price.recurring.intervalCount ?? 1)
    )
      return false;
  }
  return true;
}

async function ensureCoupon(stripe: Stripe, spec: CouponSpec): Promise<string> {
  try {
    const existing = await stripe.coupons.retrieve(spec.id);
    console.log(`reused coupon:   ${spec.key} (${existing.id})`);
    return existing.id;
  } catch (err) {
    if (!isResourceMissing(err)) throw err;
  }
  const created = await stripe.coupons.create(spec.params);
  console.log(`created coupon:  ${spec.key} (${created.id})`);
  return created.id;
}

function isResourceMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: number; code?: string };
  return e.statusCode === 404 || e.code === "resource_missing";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
