import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { subscriptions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// Payload shape accepted by the checkout endpoint. Body is optional to keep
// the existing "click Upgrade to Pro" POST-with-no-body flow working — it
// falls back to Pro Monthly, which matches legacy STRIPE_PRICE_ID_PRO.
type CheckoutRequest = {
  plan_tier?: "pro" | "student";
  plan_interval?: "monthly" | "yearly" | "four_month";
};

function priceIdFor(
  tier: "pro" | "student",
  interval: "monthly" | "yearly" | "four_month"
): { priceId: string | null; reason?: string } {
  const e = env();
  if (tier === "student") {
    if (interval !== "four_month") {
      return { priceId: null, reason: "Student plan only supports four_month interval" };
    }
    if (!e.STRIPE_PRICE_STUDENT_4MO) {
      return { priceId: null, reason: "STRIPE_PRICE_STUDENT_4MO not configured" };
    }
    return { priceId: e.STRIPE_PRICE_STUDENT_4MO };
  }
  // Pro tier
  if (interval === "monthly") {
    // Prefer the new env; fall back to legacy STRIPE_PRICE_ID_PRO so existing
    // setups don't break before stripe-setup.ts has been run.
    const id = e.STRIPE_PRICE_PRO_MONTHLY || e.STRIPE_PRICE_ID_PRO;
    if (!id) return { priceId: null, reason: "No Pro Monthly price configured" };
    return { priceId: id };
  }
  if (interval === "yearly") {
    if (!e.STRIPE_PRICE_PRO_YEARLY) {
      return { priceId: null, reason: "STRIPE_PRICE_PRO_YEARLY not configured" };
    }
    return { priceId: e.STRIPE_PRICE_PRO_YEARLY };
  }
  return {
    priceId: null,
    reason: `Pro tier does not support ${interval} interval`,
  };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  // Parse optional body. Empty body / bad JSON falls back to Pro Monthly to
  // preserve the pre-multi-tier "Upgrade to Pro" button semantics.
  let body: CheckoutRequest = {};
  try {
    const text = await request.text();
    if (text.length > 0) body = JSON.parse(text) as CheckoutRequest;
  } catch {
    // ignore — fall through to defaults
  }
  const tier = body.plan_tier ?? "pro";
  const interval =
    body.plan_interval ?? (tier === "student" ? "four_month" : "monthly");

  const picked = priceIdFor(tier, interval);
  if (!picked.priceId) {
    return NextResponse.json(
      { error: picked.reason ?? "invalid plan selection" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const customer = await stripe().customers.create({
      email: u?.email ?? session.user.email ?? undefined,
      name: u?.name ?? session.user.name ?? undefined,
      metadata: { steadii_user_id: userId },
    });
    customerId = customer.id;
  }

  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: picked.priceId, quantity: 1 }],
    success_url: `${env().APP_URL}/app/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env().APP_URL}/app/settings/billing?canceled=1`,
    allow_promotion_codes: true,
    client_reference_id: userId,
    subscription_data: {
      metadata: { steadii_user_id: userId, steadii_plan_tier: tier },
    },
  });

  return NextResponse.json({ url: checkout.url });
}
