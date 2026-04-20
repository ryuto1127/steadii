import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signIn } from "@/lib/auth/config";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import {
  stepFromStatus,
  persistOnboardingStep,
} from "@/lib/onboarding/progress";
import { runSetupAction } from "./actions";
import { NotionConnectPanel } from "@/components/onboarding/notion-connect-panel";
import { ProgressDots } from "@/components/onboarding/progress-dots";
import { WhyDisclosure } from "@/components/onboarding/why-disclosure";
import { SetupChecklist } from "@/components/onboarding/setup-checklist";

const TOTAL_STEPS = 4;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; notion_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const status = await getOnboardingStatus(session.user.id);
  if (isOnboardingComplete(status)) {
    redirect("/app");
  }

  const { step: stepParam, notion_error } = await searchParams;
  const derivedStep = stepFromStatus(status);
  // Allow ?step= to hold at step 4 (skip-or-add) once server state says 4.
  const requestedStep =
    stepParam === "resources" || stepParam === "4" ? 4 : undefined;
  const currentStep = requestedStep === 4 && derivedStep === 4 ? 4 : derivedStep;

  await persistOnboardingStep(session.user.id, currentStep);

  async function reconnectCalendar() {
    "use server";
    await signIn("google", { redirectTo: "/onboarding" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-12">
      <div className="mx-auto mb-10 w-full">
        <ProgressDots total={TOTAL_STEPS} current={currentStep} />
      </div>

      <section className="flex flex-1 flex-col items-center text-center">
        {notion_error && (
          <div className="mb-6 w-full rounded-md border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-small text-[hsl(var(--destructive))]">
            Notion connection failed: {notion_error}. Try again.
          </div>
        )}

        {currentStep === 1 && (
          <StepPane
            title="Connect Notion"
            oneLine="Steadii saves your mistakes, assignments, and syllabi into a Notion workspace you own."
            whyTitle="Why do we need this?"
            why={
              <>
                Notion is where your notes live. Steadii creates one parent page
                with 4 databases (Classes, Mistakes, Assignments, Syllabi) and
                only touches pages under that parent. You can revoke access any
                time from Notion&apos;s integrations page.
              </>
            }
          >
            <NotionConnectPanel connected={status.notionConnected} />
          </StepPane>
        )}

        {currentStep === 2 && (
          <StepPane
            title="Connect Google Calendar"
            oneLine="So Steadii can show today's schedule and add class sessions and assignment blocks for you."
            whyTitle="Why do we need this?"
            why={
              <>
                Read + write access to your primary calendar. We don&apos;t
                create events without your input — the agent asks before writing
                destructive changes.
              </>
            }
          >
            <form action={reconnectCalendar}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                Grant calendar access
              </button>
            </form>
          </StepPane>
        )}

        {currentStep === 3 && (
          <StepPane
            title="Setting up your Notion workspace"
            oneLine="We'll create one parent page and four databases under it."
            whyTitle="What does this create?"
            why={
              <>
                A Steadii parent page in your Notion workspace, plus four
                databases: Classes, Mistake Notes, Assignments, Syllabi. The
                three non-Class DBs each have a <code>Class</code> relation with
                two-way sync. Nothing outside this parent page is touched.
              </>
            }
          >
            <SetupChecklist running={false} done={status.notionSetupComplete} />
            {!status.notionSetupComplete ? (
              <form action={runSetupAction} className="mt-4">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
                >
                  Run setup
                </button>
              </form>
            ) : null}
          </StepPane>
        )}

        {currentStep === 4 && (
          <StepPane
            title="Register existing resources?"
            oneLine="Skip is a perfectly good answer. You can add more Notion pages later in Settings."
            whyTitle="What counts as a resource?"
            why={
              <>
                Any Notion page or database you want the Steadii agent to be
                able to read. Pages under the Steadii parent are auto-registered.
                Anything outside needs to be added here or in Settings →
                Resources.
              </>
            }
          >
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                Skip for now
              </Link>
              <Link
                href="/app/settings"
                className="inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3.5 py-2 text-body font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                Add resources now
              </Link>
            </div>
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
