import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { subscriptions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

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
    line_items: [{ price: env().STRIPE_PRICE_ID_PRO, quantity: 1 }],
    success_url: `${env().APP_URL}/app/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env().APP_URL}/app/settings/billing?canceled=1`,
    allow_promotion_codes: true,
    client_reference_id: userId,
    subscription_data: { metadata: { steadii_user_id: userId } },
  });

  // Use a redirect to the Stripe-hosted checkout. We return JSON so callers
  // can POST and then window.location = url themselves.
  void request;
  return NextResponse.json({ url: checkout.url });
}
