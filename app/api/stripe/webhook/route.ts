import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import {
  subscriptions,
  auditLog,
  users,
  invoices,
  processedStripeEvents,
} from "@/lib/db/schema";
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

  // Idempotency: Stripe retries the same event on transient failures or
  // signed-ack timeouts. Skip anything we've already processed to avoid
  // double-INSERTing invoice rows or double-logging audit entries. We
  // INSERT the event id FIRST — if a duplicate arrives concurrently, one
  // of them gets the unique-key violation and short-circuits.
  try {
    await db.insert(processedStripeEvents).values({
      eventId: event.id,
      type: event.type,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Already processed (or in-flight) — ack without re-running side effects.
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw err;
  }

  try {
    await routeEvent(event);
  } catch (err) {
    console.error("stripe webhook handler failed", err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Exported so tests can feed parsed Stripe.Event objects directly, bypassing
// signature verification. Per handoff DoD: unit tests must not mock the
// Stripe SDK verifier.
export async function routeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscription(sub);
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      await recordPaidInvoice(invoice);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await logInvoiceFailure(invoice);
      return;
    }
    case "checkout.session.completed": {
      // No-op for now — customer.subscription.created fires alongside with
      // everything we need. Handled explicitly so Stripe doesn't retry.
      return;
    }
    default:
      // Unhandled types are fine; idempotency row already inserted so Stripe
      // won't re-deliver.
      return;
  }
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

  // Reflect plan_interval on the user row so Settings can show "renews every
  // 4 months" vs "monthly" without re-querying Stripe.
  await db
    .update(users)
    .set({ planInterval: planIntervalFromPriceId(priceId) })
    .where(eq(users.id, userId));

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

// Mirror a paid Stripe invoice into our `invoices` table. Rows are inserted
// here and nowhere else — scope per the W1 handoff. tax_amount stays at 0
// until Stripe Tax is enabled post-α, at which point we populate it from
// invoice.tax.
async function recordPaidInvoice(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;
  const userId = await userIdForStripeCustomer(customerId);
  if (!userId) {
    console.warn("stripe webhook: no user for invoice customer", customerId);
    return;
  }

  const paidAt =
    typeof invoice.status_transitions?.paid_at === "number"
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : new Date();

  await db.insert(invoices).values({
    userId,
    stripeInvoiceId: invoice.id,
    amountTotal: invoice.amount_paid ?? invoice.amount_due ?? 0,
    amountSubtotal: invoice.subtotal ?? 0,
    // Reserved column — Stripe Tax not enabled for α. When it flips on, use
    // invoice.tax (total) and invoice.total_tax_amounts (breakdown) here.
    taxAmount: 0,
    currency: invoice.currency ?? "usd",
    paidAt,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
  });

  await db.insert(auditLog).values({
    userId,
    action: "stripe.invoice.paid",
    resourceType: "stripe_invoice",
    resourceId: invoice.id,
    result: "success",
    detail: { amount_due: invoice.amount_due, currency: invoice.currency },
  });
}

async function logInvoiceFailure(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;
  const userId = await userIdForStripeCustomer(customerId);
  if (!userId) return;
  await db.insert(auditLog).values({
    userId,
    action: "stripe.invoice.payment_failed",
    resourceType: "stripe_invoice",
    resourceId: invoice.id,
    result: "failure",
    detail: { amount_due: invoice.amount_due, currency: invoice.currency },
  });
}

function planIntervalFromPriceId(
  priceId: string | null
): "monthly" | "yearly" | "four_month" | null {
  if (!priceId) return null;
  const e = env();
  if (priceId === e.STRIPE_PRICE_PRO_MONTHLY) return "monthly";
  if (priceId === e.STRIPE_PRICE_PRO_YEARLY) return "yearly";
  if (priceId === e.STRIPE_PRICE_STUDENT_4MO) return "four_month";
  // Legacy STRIPE_PRICE_ID_PRO and any unknown prices default to monthly.
  // planFromStripePriceId in effective-plan.ts handles the tier dimension.
  return "monthly";
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
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  // PostgreSQL unique_violation error code is 23505.
  return e.code === "23505" || e.cause?.code === "23505";
}
