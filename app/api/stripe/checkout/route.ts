import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { subscriptions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAcademicEmail } from "@/lib/billing/academic-email";
import { resolveCheckoutCurrency, priceIdForPlan } from "@/lib/billing/currency";

export const runtime = "nodejs";

// Payload shape accepted by the checkout endpoint. Body is optional to keep
// the existing "click Upgrade to Pro" POST-with-no-body flow working — it
// falls back to Pro Monthly, which matches legacy STRIPE_PRICE_ID_PRO.
// promo_code, when present, is the human-readable Stripe Promotion Code
// string (e.g. one issued against FRIEND_3MO). The route resolves it to the
// internal promo_xxx id before passing to Checkout.
//
// `currency` overrides the locale-derived default (e.g. user on /ja UI but
// wants to pay in USD). Stripe Subscriptions are mono-currency, so once a
// paying user picks one this preference is pinned via the webhook.
type CheckoutRequest = {
  plan_tier?: "pro" | "student";
  plan_interval?: "monthly" | "yearly" | "four_month";
  promo_code?: string;
  currency?: "usd" | "jpy";
};

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

  // Currency precedence: explicit body override > user's preferredCurrency
  // (set on first checkout) > locale-derived default. Resolved before the
  // price lookup so JPY/USD pick the right env var.
  const [userRow] = await db
    .select({
      preferredCurrency: users.preferredCurrency,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const currency = await resolveCheckoutCurrency({
    explicit: body.currency,
    persisted: userRow?.preferredCurrency ?? null,
    request,
  });

  const picked = priceIdForPlan({ tier, interval, currency });
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

  // Student tier gate: primary email must look academic. The alternate-
  // email + verification-link flow is post-α; for now, users whose Google
  // OAuth email isn't academic need to either use a different Google
  // account or pick the regular Pro plan.
  if (tier === "student") {
    const email = userRow?.email ?? session.user.email;
    if (!isAcademicEmail(email)) {
      return NextResponse.json(
        {
          error:
            "Student plan requires an academic email (.edu, .ac.*, or a verified Canadian university domain). Sign in with your university Google account, or choose the Pro plan.",
          code: "STUDENT_EMAIL_REQUIRED",
        },
        { status: 403 }
      );
    }
  }

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: userRow?.email ?? session.user.email ?? undefined,
      name: userRow?.name ?? session.user.name ?? undefined,
      metadata: { steadii_user_id: userId },
    });
    customerId = customer.id;
  }

  // Persist the resolved currency on the user row (idempotent — only writes
  // when it would change). Done before Checkout creation so subsequent
  // top-ups/data-retention pick the same currency even if Checkout is
  // abandoned mid-flow.
  if ((userRow?.preferredCurrency ?? "usd") !== currency) {
    await db
      .update(users)
      .set({ preferredCurrency: currency })
      .where(eq(users.id, userId));
  }

  // Resolve promo_code → Stripe promotion_code id if provided. Falls back
  // to allow_promotion_codes so the user can type one in at Checkout too.
  let discounts: Array<{ promotion_code: string }> | undefined;
  if (body.promo_code) {
    const list = await stripe().promotionCodes.list({
      code: body.promo_code,
      active: true,
      limit: 1,
    });
    const promo = list.data[0];
    if (!promo) {
      return NextResponse.json(
        { error: `Invalid or expired invite code: ${body.promo_code}` },
        { status: 400 }
      );
    }
    discounts = [{ promotion_code: promo.id }];
  }

  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: picked.priceId, quantity: 1 }],
    success_url: `${env().APP_URL}/app/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env().APP_URL}/app/settings/billing?canceled=1`,
    // Can't set allow_promotion_codes when discounts is already applied —
    // Stripe rejects the combo. Leave the input open only when we're not
    // pre-applying one.
    ...(discounts ? { discounts } : { allow_promotion_codes: true }),
    client_reference_id: userId,
    subscription_data: {
      metadata: {
        steadii_user_id: userId,
        steadii_plan_tier: tier,
        ...(body.promo_code ? { steadii_invite_code: body.promo_code } : {}),
      },
    },
  });

  return NextResponse.json({ url: checkout.url });
}
