import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { subscriptions, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

// Custom cancel flow (replaces the Stripe Portal cancel for feedback
// collection). Cancels at period end by default — user retains access
// until their billing period ends, then downgrades to Free with the
// 120-day grace window. No retention offers are shown anywhere in this
// flow; Ryuto opted out of dark-pattern retention.
const bodySchema = z.object({
  reason: z
    .enum([
      "too_expensive",
      "not_enough",
      "switching",
      "privacy",
      "graduating",
      "other",
      "skipped",
    ])
    .optional()
    .default("skipped"),
  note: z.string().max(500).optional(),
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

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!sub) {
    return NextResponse.json(
      { error: "No active subscription to cancel." },
      { status: 404 }
    );
  }
  if (sub.cancelAtPeriodEnd) {
    return NextResponse.json(
      { error: "Subscription is already set to cancel at period end." },
      { status: 409 }
    );
  }

  // Stripe does the actual work; webhook fires customer.subscription.updated
  // and mirrors cancel_at_period_end=1 back into our subscriptions row. The
  // user keeps Pro access until currentPeriodEnd.
  await stripe().subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  // Feedback recorded in audit_log — no separate cancel_feedback table at α
  // scale. Ryuto can query audit_log.action='billing.canceled' to review.
  await db.insert(auditLog).values({
    userId,
    action: "billing.canceled",
    resourceType: "stripe_subscription",
    resourceId: sub.stripeSubscriptionId,
    result: "success",
    detail: {
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
