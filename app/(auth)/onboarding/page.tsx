import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signIn } from "@/lib/auth/config";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { ProgressDots } from "@/components/onboarding/progress-dots";
import { WhyDisclosure } from "@/components/onboarding/why-disclosure";
import { INTEGRATION_SOURCES } from "@/lib/integrations/suggestions/sources";
import { recordSuggestionImpression } from "@/lib/integrations/suggestions/impressions";
import { skipIntegrationsStepAction } from "./actions";

const TOTAL_STEPS = 2;

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const status = await getOnboardingStatus(session.user.id);
  if (isOnboardingComplete(status)) {
    redirect("/app");
  }

  const t = await getTranslations("onboarding");

  // Step 1: Connect Google. Once Calendar+Gmail scopes land, we move to Step 2.
  const onStep1 = !(status.calendarConnected && status.gmailConnected);
  const currentStep = onStep1 ? 1 : 2;

  async function connectGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/onboarding" });
  }

  // Record one impression per source as the page renders. Step 2 is the
  // canonical "we showed all three integrations to this user once."
  if (!onStep1) {
    await Promise.all(
      INTEGRATION_SOURCES.map((s) =>
        recordSuggestionImpression(
          session.user!.id!,
          s.id,
          "onboarding_step2"
        )
      )
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-12">
      <div className="mx-auto mb-10 w-full">
        <ProgressDots total={TOTAL_STEPS} current={currentStep} />
      </div>

      <section className="flex flex-1 flex-col items-center text-center">
        {onStep1 ? (
          <StepPane
            title={t("step1.title")}
            oneLine={t("step1.one_line")}
            whyTitle={t("step1.why_title")}
            why={
              <>
                <p>{t("step1.why_calendar_gmail")}</p>
                <p className="mt-3">{t("step1.why_notion")}</p>
              </>
            }
          >
            <form action={connectGoogle}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {t("step1.button")}
              </button>
            </form>
          </StepPane>
        ) : (
          <StepPane
            title={t("step2.title")}
            oneLine={t("step2.one_line")}
            whyTitle={t("step2.why_title")}
            why={<>{t("step2.why_body")}</>}
          >
            <ul className="flex w-full flex-col gap-3 text-left">
              {INTEGRATION_SOURCES.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {t(`step2.sources.${s.id}.label`)}
                    </span>
                    {s.href ? (
                      <Link
                        href={s.href}
                        className="text-sm text-[hsl(var(--primary))] hover:underline"
                      >
                        {t("step2.connect_link")}
                      </Link>
                    ) : (
                      <Link
                        href="/app/settings/connections#ical"
                        className="text-sm text-[hsl(var(--primary))] hover:underline"
                      >
                        {t("step2.add_url_link")}
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t(`step2.sources.${s.id}.one_line`)}
                  </p>
                </li>
              ))}
            </ul>
            <form action={skipIntegrationsStepAction}>
              <button
                type="submit"
                className="mt-4 inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] bg-transparent px-3.5 py-2 text-body text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                {t("step2.skip")}
              </button>
            </form>
          </StepPane>
        )}
      </section>
    </main>
  );
}

function StepPane({
  title,
  oneLine,
  children,
  whyTitle,
  why,
}: {
  title: string;
  oneLine: string;
  children: React.ReactNode;
  whyTitle?: string;
  why: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[hsl(var(--foreground))]">{title}</h1>
        <p className="text-small text-[hsl(var(--muted-foreground))]">{oneLine}</p>
      </div>
      <div className="flex w-full flex-col items-center gap-3">{children}</div>
      <div className="mt-2 w-full max-w-sm">
        <WhyDisclosure title={whyTitle}>{why}</WhyDisclosure>
      </div>
    </div>
  );
}
