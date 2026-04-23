import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/layout/sidebar";
import { OfflineStrip } from "@/components/layout/offline-strip";
import { RouteTransition } from "@/components/layout/route-transition";
import { ReauthBanner } from "@/components/layout/reauth-banner";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { getCreditBalance } from "@/lib/billing/credits";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const status = await getOnboardingStatus(session.user.id);
  if (!isOnboardingComplete(status)) {
    redirect("/onboarding");
  }

  const [balance, effective, subRow] = await Promise.all([
    getCreditBalance(session.user.id),
    getEffectivePlan(session.user.id),
    db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, session.user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  // Pre-Gmail users: they completed onboarding under the old scope set
  // (Calendar only). isOnboardingComplete now requires Gmail, so in
  // practice such users get redirected to /onboarding — but the banner
  // remains as a safety net and a discoverability nudge in case the
  // redirect is bypassed (e.g. re-consent flow in progress).
  const gmailConnected = status.gmailConnected;
  // Dunning takes priority over credit near-limit — a failed payment is
  // more urgent than approaching the quota ceiling.
  const pastDue = subRow?.status === "past_due";
  const showBanner =
    pastDue || (effective.plan !== "admin" && balance.nearLimit);
  const pct = Math.min(100, Math.round((balance.used / balance.limit) * 100));

  // Arc-style island: body bg = warm canvas (--background); 12px padding
  // on every edge shows the canvas; main content floats as a surface-
  // colored rounded-xl island on the right, sidebar melts into the
  // canvas on the left.
  return (
    <div className="flex h-screen gap-3 bg-[hsl(var(--background))] p-3">
      <Sidebar
        creditsUsed={balance.used}
        creditsLimit={balance.limit}
        plan={effective.plan}
      />
      <main className="relative flex-1 overflow-y-auto rounded-xl bg-[hsl(var(--surface))] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
        <OfflineStrip />
        <div className="px-10 py-8">
          {!gmailConnected && <ReauthBanner />}
          {pastDue && (
            <div className="mx-auto mb-5 max-w-4xl rounded-lg bg-[hsl(var(--destructive)/0.08)] px-4 py-2.5 text-small text-[hsl(var(--destructive))]">
              <div className="flex items-center justify-between gap-4">
                <span>
                  Your last payment failed. Update your card to keep Pro
                  access — Stripe will retry automatically over the next two
                  weeks before we downgrade to Free.
                </span>
                <Link
                  href="/app/settings/billing"
                  className="shrink-0 rounded-md px-3 py-1 text-small transition-hover hover:bg-[hsl(var(--surface))]"
                >
                  Update payment
                </Link>
              </div>
            </div>
          )}
          {!pastDue && showBanner && (
            <div
              className={`mx-auto mb-5 max-w-4xl rounded-lg px-4 py-2.5 text-small ${
                balance.exceeded
                  ? "bg-[hsl(var(--destructive)/0.08)] text-[hsl(var(--destructive))]"
                  : "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <span>
                  {balance.exceeded
                    ? `Out of credits this cycle (${balance.used.toLocaleString()} / ${balance.limit.toLocaleString()}). Chat continues; agent drafts and other metered features pause until reset or top-up.`
                    : `You've used ${pct}% of your cycle credits (${balance.used.toLocaleString()} / ${balance.limit.toLocaleString()}).`}
                </span>
                <Link
                  href="/app/settings/billing"
                  className="shrink-0 rounded-md px-3 py-1 text-small transition-hover hover:bg-[hsl(var(--surface))]"
                >
                  {effective.plan === "free"
                    ? "Upgrade"
                    : balance.exceeded
                    ? "Top up"
                    : "Manage"}
                </Link>
              </div>
            </div>
          )}
          <RouteTransition>{children}</RouteTransition>
        </div>
      </main>
    </div>
  );
}
