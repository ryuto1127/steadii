import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { subscriptions, auditLog, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncUsersPlanColumn } from "@/lib/billing/effective-plan";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `invalid signature: ${err instanceof Error ? err.message : ""}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await upsertSubscription(sub);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        // Subscription status changes also fire a subscription.updated event,
        // which carries the right status. We still note the invoice outcome
        // in audit_log for observability.
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        const userId = await userIdForStripeCustomer(customerId);
        if (userId) {
          await db.insert(auditLog).values({
            userId,
            action:
              event.type === "invoice.paid"
                ? "stripe.invoice.paid"
                : "stripe.invoice.payment_failed",
            resourceType: "stripe_invoice",
            resourceId: invoice.id,
            result: event.type === "invoice.paid" ? "success" : "failure",
            detail: { amount_due: invoice.amount_due, currency: invoice.currency },
          });
        }
        break;
      }
      default:
        // Unhandled types are fine; return 200 so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error("stripe webhook handler failed", err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

type SubscriptionLike = Stripe.Subscription & {
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null;
};

async function upsertSubscription(sub: SubscriptionLike) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId =
    sub.metadata?.steadii_user_id ??
    (await userIdForStripeCustomer(customerId));
  if (!userId) {
    console.warn("stripe webhook: no user for customer", customerId);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const currentPeriodEnd =
    typeof sub.current_period_end === "number"
      ? new Date(sub.current_period_end * 1000)
      : null;

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        status: sub.status as SubscriptionLike["status"],
        stripePriceId: priceId,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      status: sub.status as SubscriptionLike["status"],
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
    });
  }

  await db.insert(auditLog).values({
    userId,
    action: `stripe.subscription.${sub.status}`,
    resourceType: "stripe_subscription",
    resourceId: sub.id,
    result: "success",
    detail: { priceId, current_period_end: sub.current_period_end ?? null },
  });

  await syncUsersPlanColumn(userId);
}

async function userIdForStripeCustomer(
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  if (row) return row.userId;
  // Fall back to customer metadata by calling Stripe.
  try {
    const customer = await stripe().customers.retrieve(customerId);
    if (!customer.deleted) {
      const md = (customer as Stripe.Customer).metadata ?? {};
      return md.steadii_user_id ?? null;
    }
  } catch {
    // ignore
  }
  void users; // keep the import alive for future expansion
  return null;
}
