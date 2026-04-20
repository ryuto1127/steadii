import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/layout/sidebar";
import { OfflineStrip } from "@/components/layout/offline-strip";
import { StatusBar } from "@/components/layout/status-bar";
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

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <Sidebar />
      <div className="relative flex min-h-screen flex-1 flex-col">
        <main className="relative flex-1 px-6 py-5">
          <span aria-hidden className="ambient-amber" />
          <OfflineStrip />
          {showBanner && (
            <div
              className={`relative z-10 mx-auto mb-4 max-w-4xl rounded-md border px-3 py-2 text-small ${
                balance.exceeded
                  ? "border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] text-[hsl(var(--destructive))]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
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
                  className="shrink-0 rounded-md border border-[hsl(var(--border))] px-3 py-1 text-small transition-hover hover:bg-[hsl(var(--surface))]"
                >
                  {effective.plan === "free" ? "Upgrade" : "Manage"}
                </Link>
              </div>
            </div>
          )}
          <div className="relative z-10">{children}</div>
        </main>
        <StatusBar
          creditsUsed={balance.used}
          creditsLimit={balance.limit}
          plan={effective.plan}
        />
      </div>
    </div>
  );
}
