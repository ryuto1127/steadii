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
  getPersistedOnboardingStep,
} from "@/lib/onboarding/progress";
import {
  runSetupAction,
  skipNotionAction,
  finishOnboardingAction,
} from "./actions";
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
    // First-24h email ingest only needs to run on the final step actions.
    // If the user is already complete, send them to the app.
    redirect("/app");
  }

  const { step: stepParam, notion_error } = await searchParams;
  const persistedStep = await getPersistedOnboardingStep(session.user.id);
  const derivedStep = stepFromStatus(status, persistedStep);
  // Allow ?step= to hold at step 4 (skip-or-add) once server state says 4.
  const requestedStep =
    stepParam === "resources" || stepParam === "4" ? 4 : undefined;
  const currentStep = requestedStep === 4 && derivedStep === 4 ? 4 : derivedStep;

  await persistOnboardingStep(session.user.id, currentStep);

  async function connectGoogle() {
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
        )}

        {currentStep === 2 && (
          <StepPane
            title="Connect Notion (optional)"
            oneLine="Adds class-relation context to triage. Skip if you don't use Notion — you can add it later in Settings."
            whyTitle="Why bother?"
            why={
              <>
                Notion gives Steadii the map of your classes, mistakes,
                assignments, and syllabi. With it, the agent can tie an incoming
                email to the right course. Without it, triage still works —
                you just get less context in each draft.
              </>
            }
          >
            <NotionConnectPanel connected={status.notionConnected} />
            <form action={skipNotionAction} className="mt-2">
              <button
                type="submit"
                className="text-small text-[hsl(var(--muted-foreground))] underline-offset-4 transition-hover hover:text-[hsl(var(--foreground))] hover:underline"
              >
                Skip for now
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
              <form action={finishOnboardingAction}>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
                >
                  Skip for now
                </button>
              </form>
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
