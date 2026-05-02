import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dismissOnboardingSkipRecoveryAction } from "@/app/(auth)/onboarding/actions";

// Wave 5 — soft re-prompt for the "skipped Step 2 integrations"
// path. Renders only after the user has had at least one inbox item
// (i.e. they've used the secretary enough that "want more from this?"
// is the right question). Dismissing stamps a flag so the banner
// never re-renders.
export async function OnboardingSkipRecoveryBanner() {
  const t = await getTranslations("onboarding_skip_recovery_banner");
  return (
    <div className="mx-auto mb-5 max-w-4xl rounded-lg border border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.05)] px-4 py-2.5 text-small text-[hsl(var(--foreground))]">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="font-medium">{t("heading")}</p>
          <p className="mt-0.5 text-[hsl(var(--muted-foreground))]">
            {t("body")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/app/settings/connections"
            className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {t("connect")}
          </Link>
          <form action={dismissOnboardingSkipRecoveryAction}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
              aria-label={t("dismiss_aria")}
            >
              {t("dismiss")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
