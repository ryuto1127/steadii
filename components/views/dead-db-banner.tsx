import { AlertTriangle } from "lucide-react";
import { repairSetupAction } from "@/app/(auth)/onboarding/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export function DeadDbBanner({
  title,
  reason,
}: {
  title: string;
  reason: "not_connected" | "not_set_up" | "deleted";
}) {
  const messages: Record<typeof reason, string> = {
    not_connected:
      "Notion isn't connected yet. Connect it in Settings.",
    not_set_up:
      "Your Steadii workspace in Notion hasn't been set up. Run setup to continue.",
    deleted:
      "The Steadii workspace in Notion looks gone. Click below to recreate it — existing Notion pages outside the workspace aren't touched.",
  };

  const heading =
    reason === "not_connected"
      ? "Notion connection expired."
      : reason === "not_set_up"
      ? "Setup hasn't run yet."
      : "Steadii workspace missing.";

  return (
    <div className="mx-auto max-w-3xl py-6">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">{title}</h1>
      <div className="mt-6">
        <EmptyState
          tone="warn"
          icon={<AlertTriangle size={18} strokeWidth={1.5} />}
          title={heading}
          description={
            <>
              {messages[reason]}
              <div className="mt-1 text-[hsl(var(--muted-foreground))]">
                Your data is safe.
              </div>
            </>
          }
        />
        <div className="mt-3 flex justify-center">
          {reason === "not_connected" ? (
            <LinkButton href="/app/settings">Reconnect Notion</LinkButton>
          ) : (
            <form action={repairSetupAction}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                Re-setup Notion
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
