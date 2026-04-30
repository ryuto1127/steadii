import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/layout/sidebar";
import { OfflineStrip } from "@/components/layout/offline-strip";
import { RouteTransition } from "@/components/layout/route-transition";
import { ReauthBanner } from "@/components/layout/reauth-banner";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Logo } from "@/components/layout/logo";
import {
  MobileNavProvider,
  MobileNavTrigger,
  MobileNavDrawer,
} from "@/components/layout/mobile-nav";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { getCreditBalance } from "@/lib/billing/credits";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import { maybeTriggerAutoIngest } from "@/lib/agent/email/auto-ingest";
import { getUserVoiceTriggerKey } from "@/lib/agent/preferences";
import { VoiceAppProvider } from "@/components/voice/voice-app-provider";
import { VoiceHint } from "@/components/voice/voice-hint";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Onboarding redirects gate every /app/* route on getOnboardingStatus, so
// any static optimization of this layout risks serving a stale redirect
// after a state-changing server action (e.g. the Step 2 skip). Pin to
// dynamic so each request re-evaluates against the live DB.
export const dynamic = "force-dynamic";

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

  const [balance, effective, subRow, voiceTriggerKey] = await Promise.all([
    getCreditBalance(session.user.id),
    getEffectivePlan(session.user.id),
    db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, session.user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getUserVoiceTriggerKey(session.user.id),
  ]);
  // Pre-Gmail users: they completed onboarding under the old scope set
  // (Calendar only). isOnboardingComplete now requires Gmail, so in
  // practice such users get redirected to /onboarding — but the banner
  // remains as a safety net and a discoverability nudge in case the
  // redirect is bypassed (e.g. re-consent flow in progress).
  const gmailConnected = status.gmailConnected;
  // Fire-and-forget first-ingest trigger. Runs once per 24h per user; no
  // blocking on render. Covers the "scope granted via re-auth but never
  // went through onboarding" path.
  await maybeTriggerAutoIngest({
    userId: session.user.id,
    gmailConnected,
  });
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
  //
  // Mobile (<md): the rail is replaced by a slide-in drawer; a fixed
  // top bar surfaces the hamburger + brand + notifications. Padding
  // shrinks to p-0 (gap and outer padding belong to desktop). Main
  // content takes the full width and the rounded-xl island is dropped
  // since there's no canvas around it on small screens.
  return (
    <MobileNavProvider>
     <VoiceAppProvider voiceTriggerKey={voiceTriggerKey}>
      <div className="flex h-[100dvh] flex-col bg-[hsl(var(--background))] md:h-screen md:flex-row md:gap-3 md:p-3">
        {/* Mobile top bar — md:hidden. Sticky-on-canvas above the main
            island. Holds the hamburger, the brand mark, and the bell. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 md:hidden">
          <MobileNavTrigger />
          <Link
            href="/app"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[hsl(var(--foreground))]"
            aria-label="Steadii home"
          >
            <Logo size={24} />
            <span>Steadii</span>
          </Link>
          {gmailConnected ? (
            <div className="ml-auto">
              <NotificationBell userId={session.user.id} />
            </div>
          ) : null}
        </header>

        {/* Desktop rail — md+ only. The original w-14 hover-to-w-60
            sidebar pattern stays unchanged here. */}
        <div className="hidden md:flex md:flex-shrink-0">
          <Sidebar
            creditsUsed={balance.used}
            creditsLimit={balance.limit}
            plan={effective.plan}
          />
        </div>

        {/* Mobile drawer — md:hidden inside MobileNavDrawer. Holds the
            full expanded sidebar so a tap on the hamburger reveals the
            same nav surface (just with all labels visible). */}
        <MobileNavDrawer>
          <Sidebar
            creditsUsed={balance.used}
            creditsLimit={balance.limit}
            plan={effective.plan}
            variant="expanded"
          />
        </MobileNavDrawer>

        <main className="relative flex-1 overflow-y-auto bg-[hsl(var(--surface))] md:rounded-xl md:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] md:ring-1 md:ring-black/[0.04]">
          <OfflineStrip />
          {/* Desktop-only floating bell (top-right of the island). Mobile
              gets the bell inside the top bar above. */}
          {gmailConnected ? (
            <div className="absolute right-4 top-4 z-10 hidden md:block">
              <NotificationBell userId={session.user.id} />
            </div>
          ) : null}
          <div className="px-4 py-5 sm:px-6 md:px-10 md:py-8">
            {!gmailConnected && <ReauthBanner />}
            {pastDue && (
              <div className="mx-auto mb-5 max-w-4xl rounded-lg bg-[hsl(var(--destructive)/0.08)] px-4 py-2.5 text-small text-[hsl(var(--destructive))]">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
      <VoiceHint />
     </VoiceAppProvider>
    </MobileNavProvider>
  );
}
