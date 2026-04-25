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
  topupBalances,
} from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { syncUsersPlanColumn } from "@/lib/billing/effective-plan";
import { currencyFromStripePriceId } from "@/lib/billing/currency";

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
      // Subscription Checkouts trigger customer.subscription.created with
      // everything we need — skip them here. One-time purchases (top-up
      // packs + Data Retention Extension) arrive in `mode: "payment"` and
      // get fulfilled via the steadii_action metadata we stashed on create.
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "payment") {
        await fulfillOneTimePurchase(s);
      }
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
    // First paid subscription for this user → maybe flag as Founding Member.
    // Per project_decisions.md: first 100 paid users get a permanent price
    // lock. User 101+ gets a 12-month lock from now.
    if (sub.status === "active" || sub.status === "trialing") {
      await maybeGrantFoundingMembership(userId);
    }
  }

  // Reflect plan_interval and preferred currency on the user row so Settings
  // can show "renews every 4 months" vs "monthly" without re-querying Stripe,
  // and so subsequent top-ups stay in the same currency.
  await db
    .update(users)
    .set({
      planInterval: planIntervalFromPriceId(priceId),
      preferredCurrency: currencyFromStripePriceId(priceId),
    })
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

// Founding member automation. Fires once per user, the first time they hit
// an active Stripe subscription. If fewer than 100 users already carry the
// flag, this user becomes a founding member with a permanent price lock
// (founding_member = true, grandfather_price_locked_until = null). Otherwise
// they get a 12-month lock from now instead.
//
// Race window: two webhooks processing concurrent first-subscriptions could
// both read count=99 and both set the flag. At α scale that's not a real
// risk; at scale use a row-level lock or advisory lock when it matters.
const FOUNDING_MEMBER_CAP = 100;
const GRANDFATHER_LOCK_MS = 365 * 24 * 60 * 60 * 1000;

async function maybeGrantFoundingMembership(userId: string): Promise<void> {
  const [current] = await db
    .select({
      foundingMember: users.foundingMember,
      grandfatherPriceLockedUntil: users.grandfatherPriceLockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Already processed for this user — don't overwrite.
  if (
    current?.foundingMember === true ||
    current?.grandfatherPriceLockedUntil !== null
  ) {
    return;
  }

  const [{ n } = { n: 0 }] = await db
    .select({ n: count(users.id) })
    .from(users)
    .where(eq(users.foundingMember, true));
  const existingFounders = Number(n);

  if (existingFounders < FOUNDING_MEMBER_CAP) {
    await db
      .update(users)
      .set({ foundingMember: true })
      .where(eq(users.id, userId));
    await db.insert(auditLog).values({
      userId,
      action: "billing.founding_member_granted",
      resourceType: "user",
      resourceId: userId,
      result: "success",
      detail: { cap: FOUNDING_MEMBER_CAP, existingFounders },
    });
  } else {
    const lockUntil = new Date(Date.now() + GRANDFATHER_LOCK_MS);
    await db
      .update(users)
      .set({ grandfatherPriceLockedUntil: lockUntil })
      .where(eq(users.id, userId));
    await db.insert(auditLog).values({
      userId,
      action: "billing.grandfather_lock_granted",
      resourceType: "user",
      resourceId: userId,
      result: "success",
      detail: { lockUntil: lockUntil.toISOString() },
    });
  }
}

// Fulfill a one-time purchase (top-up packs or data retention extension)
// based on the `steadii_action` metadata set at Checkout creation. The
// session-level metadata is the canonical source — we fall back to the
// payment_intent's copy if missing.
async function fulfillOneTimePurchase(s: Stripe.Checkout.Session) {
  const action =
    s.metadata?.steadii_action ??
    (typeof s.payment_intent === "object" && s.payment_intent
      ? (s.payment_intent as Stripe.PaymentIntent).metadata?.steadii_action
      : undefined);
  const userId =
    s.metadata?.steadii_user_id ??
    (typeof s.customer === "string" || s.customer === null
      ? await userIdForStripeCustomer(
          typeof s.customer === "string" ? s.customer : null
        )
      : await userIdForStripeCustomer(s.customer.id));

  if (!userId || !action) {
    console.warn("checkout.session.completed: no user/action", {
      action,
      userId,
    });
    return;
  }

  if (action === "topup_500" || action === "topup_2000") {
    // 90-day expiry on unused credits. Insert one row per purchase so we
    // can track expiry per-pack (earliest-expiring consumed first).
    const credits = action === "topup_500" ? 500 : 2000;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const invoiceId =
      typeof s.invoice === "string"
        ? s.invoice
        : s.invoice?.id ?? s.id; // fallback to session id if no invoice
    try {
      await db.insert(topupBalances).values({
        userId,
        stripeInvoiceId: invoiceId,
        creditsPurchased: credits,
        creditsRemaining: credits,
        expiresAt,
      });
    } catch (err) {
      // Unique violation on stripe_invoice_id = double-fire, safe to ignore.
      if (!isUniqueViolation(err)) throw err;
    }
    await db.insert(auditLog).values({
      userId,
      action: `stripe.topup.${action}`,
      resourceType: "stripe_checkout_session",
      resourceId: s.id,
      result: "success",
      detail: { credits, expiresAt: expiresAt.toISOString() },
    });
    return;
  }

  if (action === "data_retention") {
    // Extend retention from the default 120-day grace to 12 months from now.
    // If the user already has an extension active, push it forward by 12
    // months from either now or the existing expiry, whichever is later.
    const now = new Date();
    const oneYearFromNow = new Date(
      now.getTime() + 365 * 24 * 60 * 60 * 1000
    );
    const [row] = await db
      .select({ expires: users.dataRetentionExpiresAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const baseline =
      row?.expires && row.expires.getTime() > now.getTime()
        ? row.expires
        : now;
    const nextExpiry = new Date(
      baseline.getTime() + 365 * 24 * 60 * 60 * 1000
    );
    await db
      .update(users)
      .set({ dataRetentionExpiresAt: nextExpiry })
      .where(eq(users.id, userId));
    await db.insert(auditLog).values({
      userId,
      action: "stripe.data_retention.extended",
      resourceType: "stripe_checkout_session",
      resourceId: s.id,
      result: "success",
      detail: {
        previousExpiry: row?.expires?.toISOString() ?? null,
        newExpiry: nextExpiry.toISOString(),
        default_grace_ms: 120 * 24 * 60 * 60 * 1000,
        // Keep oneYearFromNow around for debugging: tells us if the user
        // stacked extensions (nextExpiry > oneYearFromNow) or not.
        one_year_from_now: oneYearFromNow.toISOString(),
      },
    });
    return;
  }

  console.warn("checkout.session.completed: unknown action", { action });
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
  if (priceId === e.STRIPE_PRICE_PRO_MONTHLY_JPY) return "monthly";
  if (priceId === e.STRIPE_PRICE_PRO_YEARLY_JPY) return "yearly";
  if (priceId === e.STRIPE_PRICE_STUDENT_4MO_JPY) return "four_month";
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
