import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/layout/sidebar";
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
    <div className="flex min-h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <main className="flex-1 px-10 py-10">
        {showBanner && (
          <div
            className={`mx-auto mb-6 max-w-4xl rounded-lg px-4 py-3 text-sm ${
              balance.exceeded
                ? "bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]"
                : "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--foreground))]"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <span>
                {balance.exceeded
                  ? `Out of credits for this month (${balance.used} / ${balance.limit}). Chat is paused.`
                  : `You've used ${pct}% of your monthly credits (${balance.used} / ${balance.limit}).`}
              </span>
              <Link
                href="/app/settings/billing"
                className="shrink-0 rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs transition hover:bg-[hsl(var(--surface-raised))]"
              >
                {effective.plan === "free" ? "Upgrade" : "Manage"}
              </Link>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
