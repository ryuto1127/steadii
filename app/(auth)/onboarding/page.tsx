import Link from "next/link";
import { redirect } from "next/navigation";
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
            title="Connect Google"
            oneLine="One consent grants Calendar + Gmail so Steadii can schedule, triage, and draft."
            whyTitle="What does this grant?"
            why={
              <>
                Read + write access to your Calendar and read/modify/send on
                Gmail. The agent triages incoming mail and prepares drafts for
                your review — nothing sends without your confirmation and a
                20-second undo window. You can revoke access anytime from your
                Google account.
                <br />
                <br />
                Notion is optional and lives in Settings → Connections — connect
                it to import your existing classes, mistakes, syllabi, and
                assignments into Steadii.
              </>
            }
          >
            <form action={connectGoogle}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                Grant Google access
              </button>
            </form>
          </StepPane>
        ) : (
          <StepPane
            title="Add more sources (optional)"
            oneLine="These widen what Steadii can see — Outlook, school timetables, Notion. Skip whatever you don't use."
            whyTitle="What gets connected?"
            why={
              <>
                Each source plugs into the same calendar + tasks pipeline as
                Google. Microsoft 365 mirrors Outlook events and To Do tasks;
                an iCal subscription pulls a school timetable feed every 6
                hours; Notion imports your existing classes and notes. You can
                add or remove any of these later from Settings → Connections.
              </>
            }
          >
            <ul className="flex w-full flex-col gap-3 text-left">
              {INTEGRATION_SOURCES.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{s.label}</span>
                    {s.href ? (
                      <Link
                        href={s.href}
                        className="text-sm text-[hsl(var(--primary))] hover:underline"
                      >
                        Connect →
                      </Link>
                    ) : (
                      <Link
                        href="/app/settings/connections#ical"
                        className="text-sm text-[hsl(var(--primary))] hover:underline"
                      >
                        Add URL →
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {s.oneLine}
                  </p>
                </li>
              ))}
            </ul>
            <form action={skipIntegrationsStepAction}>
              <button
                type="submit"
                className="mt-4 inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] bg-transparent px-3.5 py-2 text-body text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                Skip for now
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
