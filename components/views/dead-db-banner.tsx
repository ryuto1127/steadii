import { repairSetupAction } from "@/app/(auth)/onboarding/actions";

export function DeadDbBanner({
  title,
  reason,
}: {
  title: string;
  reason: "not_connected" | "not_set_up" | "deleted";
}) {
  const messages: Record<typeof reason, string> = {
    not_connected:
      "Notion isn't connected yet. Connect it in Settings → Connections.",
    not_set_up:
      "Your Steadii workspace in Notion hasn't been set up. Run setup to continue.",
    deleted:
      "The Steadii workspace in Notion looks gone (you may have deleted the page). Click below to recreate it — existing Notion pages outside the workspace aren't touched.",
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-3xl">{title}</h1>
      <div className="mt-8 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6">
        <h2 className="text-lg font-medium">
          {reason === "not_connected"
            ? "Notion not connected"
            : reason === "not_set_up"
            ? "Setup hasn't run yet"
            : "Steadii workspace missing"}
        </h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          {messages[reason]}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {reason === "not_connected" ? (
            <a
              href="/app/settings/connections"
              className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
            >
              Go to connections
            </a>
          ) : (
            <form action={repairSetupAction}>
              <button
                type="submit"
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
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
