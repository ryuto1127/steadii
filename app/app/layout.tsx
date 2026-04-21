import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/layout/sidebar";
import { OfflineStrip } from "@/components/layout/offline-strip";
import { RouteTransition } from "@/components/layout/route-transition";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { getCreditBalance } from "@/lib/billing/credits";
import { getEffectivePlan } from "@/lib/billing/effective-plan";

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

  const [balance, effective] = await Promise.all([
    getCreditBalance(session.user.id),
    getEffectivePlan(session.user.id),
  ]);
  const showBanner = effective.plan !== "admin" && balance.nearLimit;
  const pct = Math.min(100, Math.round((balance.used / balance.limit) * 100));

  // Arc-style island: body bg = warm canvas (--background); 12px padding
  // on every edge shows the canvas; main content floats as a surface-
  // colored rounded-xl island on the right, sidebar melts into the
  // canvas on the left.
  return (
    <div className="flex h-screen gap-3 bg-[hsl(var(--background))] p-3">
      <Sidebar
        creditsRemaining={Math.max(0, balance.limit - balance.used)}
        plan={effective.plan}
      />
      <main className="relative flex-1 overflow-y-auto rounded-xl bg-[hsl(var(--surface))] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
        <OfflineStrip />
        <div className="px-10 py-8">
          {showBanner && (
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
                    ? `Out of credits for this month (${balance.used} / ${balance.limit}). Chat is paused.`
                    : `You've used ${pct}% of your monthly credits (${balance.used} / ${balance.limit}).`}
                </span>
                <Link
                  href="/app/settings"
                  className="shrink-0 rounded-md px-3 py-1 text-small transition-hover hover:bg-[hsl(var(--surface))]"
                >
                  {effective.plan === "free" ? "Upgrade" : "Manage"}
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
