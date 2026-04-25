import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth/config";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { ProgressDots } from "@/components/onboarding/progress-dots";
import { WhyDisclosure } from "@/components/onboarding/why-disclosure";

const TOTAL_STEPS = 1;

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const status = await getOnboardingStatus(session.user.id);
  if (isOnboardingComplete(status)) {
    redirect("/app");
  }

  async function connectGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/onboarding" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-12">
      <div className="mx-auto mb-10 w-full">
        <ProgressDots total={TOTAL_STEPS} current={1} />
      </div>

      <section className="flex flex-1 flex-col items-center text-center">
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
