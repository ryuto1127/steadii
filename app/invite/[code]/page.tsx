import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { stripe } from "@/lib/billing/stripe";
import { AcceptInviteButton } from "./accept-button";

export const dynamic = "force-dynamic";

// Public invite landing page. `code` is a human-readable Stripe Promotion
// Code (issued by Ryuto against the FRIEND_3MO coupon). The page validates
// the code up front so invitees who clicked a typo'd URL see a clear error
// rather than a Stripe Checkout dead-end.
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await auth();

  // Validate the code against Stripe. Cheap one-shot API call — an invite
  // page view is rare. No rate-limit concern at α scale.
  const list = await stripe().promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });
  const promo = list.data[0] ?? null;

  if (!promo) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-h1">Invite link not valid</h1>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          This invitation has been revoked, used, or expired. Ask whoever sent
          you the link for a fresh one.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-sm font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          Back to Steadii
        </Link>
      </div>
    );
  }

  // Not signed in → bounce through /login with a callback back to this page.
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${code}`)}`);
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-h1">You&apos;re invited to Steadii Pro</h1>
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        This invite unlocks 3 months of Pro — full AI agent, 1000 credits per
        cycle, everything. No charge for the first three months; the plan then
        rolls to the standard Pro price unless you cancel.
      </p>

      <div className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm">
        <div className="flex items-baseline justify-between">
          <span>Today</span>
          <span className="font-mono">$0.00</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[hsl(var(--muted-foreground))]">
          <span>After 3 months</span>
          <span className="font-mono">$20 / month</span>
        </div>
      </div>

      <AcceptInviteButton code={code} />

      <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
        You can cancel any time before the trial ends from Settings → Billing.
      </p>
    </div>
  );
}
