import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth/config";
import {
  getOnboardingStatus,
  isOnboardingComplete,
} from "@/lib/onboarding/status";
import { runSetupAction } from "./actions";
import { NotionConnectPanel } from "@/components/onboarding/notion-connect-panel";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; notion_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const status = await getOnboardingStatus(session.user.id);
  if (isOnboardingComplete(status)) {
    redirect("/app/chat");
  }

  const { step, notion_error } = await searchParams;

  async function reconnectCalendar() {
    "use server";
    await signIn("google", { redirectTo: "/onboarding" });
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="font-serif text-4xl">Welcome to Steadii</h1>
      <p className="mt-3 text-[hsl(var(--muted-foreground))]">
        A two-minute setup. Connect the tools you already use; we&apos;ll do the
        rest.
      </p>

      {notion_error && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--destructive)/0.1)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          Notion connection failed: {notion_error}. Try again.
        </div>
      )}

      <ol className="mt-10 space-y-8">
        <Step
          n={1}
          title="Connect Notion"
          done={status.notionConnected}
          body={<NotionConnectPanel connected={status.notionConnected} />}
        />

        <Step
          n={2}
          title="Google Calendar access"
          done={status.calendarConnected}
          body={
            status.calendarConnected ? (
              <p className="text-[hsl(var(--muted-foreground))]">Granted.</p>
            ) : (
              <form action={reconnectCalendar}>
                <button
                  type="submit"
                  className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
                >
                  Grant calendar access
                </button>
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  You&apos;ll re-sign in with Google to authorize calendar
                  scopes.
                </p>
              </form>
            )
          }
        />

        <Step
          n={3}
          title="Create your Steadii workspace in Notion"
          done={status.notionSetupComplete}
          body={
            !status.notionConnected ? (
              <p className="text-[hsl(var(--muted-foreground))]">
                Connect Notion first.
              </p>
            ) : status.notionSetupComplete ? (
              <p className="text-[hsl(var(--muted-foreground))]">
                Parent page and three databases created.
              </p>
            ) : (
              <form action={runSetupAction}>
                <button
                  type="submit"
                  className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
                >
                  Run setup
                </button>
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Creates a &ldquo;Steadii&rdquo; page with Mistake Notes,
                  Assignments, and Syllabi databases.
                </p>
              </form>
            )
          }
        />

        <Step
          n={4}
          title="Optional: register existing resources"
          done={false}
          body={
            <div className="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
              <p>
                You can add more Notion pages later in Settings → Resources.
                When you&apos;re done, head to the app.
              </p>
              <Link
                href="/app/chat"
                className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
              >
                Continue to Steadii
              </Link>
            </div>
          }
        />
      </ol>

      {step === "resources" && null}
    </main>
  );
}

function Step({
  n,
  title,
  done,
  body,
}: {
  n: number;
  title: string;
  done: boolean;
  body: React.ReactNode;
}) {
  return (
    <li className="flex gap-5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm ${
          done
            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]"
        }`}
      >
        {done ? "✓" : n}
      </div>
      <div className="flex-1 space-y-3">
        <h2 className="text-lg font-medium text-[hsl(var(--foreground))]">
          {title}
        </h2>
        {body}
      </div>
    </li>
  );
}
