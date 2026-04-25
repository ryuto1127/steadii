import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { subscriptions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  priceIdForPack as priceIdForPackByCurrency,
  resolveCheckoutCurrency,
} from "@/lib/billing/currency";

export const runtime = "nodejs";

// One-time purchases: top-up credit packs (+500 / +2000) and the
// Data Retention Extension ($10 → 12-month retention). All share the
// same Stripe Checkout shape (mode: payment) and dispatch on the
// `steadii_action` metadata key in the webhook handler.

const bodySchema = z.object({
  pack: z.enum(["topup_500", "topup_2000", "data_retention"]),
  currency: z.enum(["usd", "jpy"]).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const pack = parsed.data.pack;

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
    explicit: parsed.data.currency,
    persisted: userRow?.preferredCurrency ?? null,
    request,
  });

  const picked = priceIdForPackByCurrency({ pack, currency });
  if (!picked.priceId) {
    return NextResponse.json(
      { error: picked.reason ?? "invalid pack" },
      { status: 400 }
    );
  }

  // Reuse the existing Stripe customer if the user already has one. Create
  // on first purchase otherwise.
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: userRow?.email ?? session.user.email ?? undefined,
      name: userRow?.name ?? session.user.name ?? undefined,
      metadata: { steadii_user_id: userId },
    });
    customerId = customer.id;
  }

  if ((userRow?.preferredCurrency ?? "usd") !== currency) {
    await db
      .update(users)
      .set({ preferredCurrency: currency })
      .where(eq(users.id, userId));
  }

  const checkout = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: picked.priceId, quantity: 1 }],
    success_url: `${env().APP_URL}/app/settings/billing?topup=${pack}`,
    cancel_url: `${env().APP_URL}/app/settings/billing?canceled=1`,
    client_reference_id: userId,
    // Webhook dispatches on this metadata to decide whether to INSERT a
    // topup_balances row or bump data_retention_expires_at.
    metadata: { steadii_user_id: userId, steadii_action: pack },
    payment_intent_data: {
      metadata: { steadii_user_id: userId, steadii_action: pack },
    },
  });

  return NextResponse.json({ url: checkout.url });
}
