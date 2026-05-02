import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("invite_page");

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
        <h1 className="text-h1">{t("invalid_title")}</h1>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          {t("invalid_body")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-sm font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          {t("back_to_steadii")}
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
      <h1 className="text-h1">{t("invite_title")}</h1>
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        {t("invite_body")}
      </p>

      <div className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm">
        <div className="flex items-baseline justify-between">
          <span>{t("today_label")}</span>
          <span className="font-mono">$0.00</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[hsl(var(--muted-foreground))]">
          <span>{t("after_3mo_label")}</span>
          <span className="font-mono">{t("price_after")}</span>
        </div>
      </div>

      <AcceptInviteButton code={code} />

      <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
        {t("cancel_anytime")}
      </p>
    </div>
  );
}
