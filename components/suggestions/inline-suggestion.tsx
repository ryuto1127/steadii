import Link from "next/link";
import {
  type IntegrationSourceId,
  type SuggestionSurface,
} from "@/lib/db/schema";
import { dismissSuggestionAction } from "@/lib/integrations/suggestions/actions";

type Variant = "pill" | "card";

type Props = {
  source: IntegrationSourceId;
  surface: SuggestionSurface;
  // Where the dismiss action should revalidate after writing the row.
  revalidatePath: string;
  // Where the connect button takes the user. iCal renders a "Manage in
  // Settings" link instead of a one-click connect.
  connectHref: string;
  connectLabel: string;
  // The reason copy shown to the user (why this is being suggested now).
  reason: string;
  variant?: Variant;
};

// Shared inline-suggestion surface used by the three contextual triggers
// (Trigger A inbox pill, Trigger B chat card, Trigger C mistakes card).
// Renders a small bordered block with a connect CTA and a Dismiss action;
// the Dismiss form posts to dismissSuggestionAction which writes one row
// to integration_suggestion_dismissals and revalidates the surface path.
export function InlineSuggestion({
  source,
  surface,
  revalidatePath,
  connectHref,
  connectLabel,
  reason,
  variant = "card",
}: Props) {
  const isPill = variant === "pill";
  const containerClass = isPill
    ? "mt-3 flex flex-wrap items-center gap-3 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-2 text-sm"
    : "mt-4 flex flex-col gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm";

  return (
    <div className={containerClass} data-suggestion-source={source}>
      <p className="flex-1 text-[hsl(var(--muted-foreground))]">{reason}</p>
      <div className="flex items-center gap-2">
        <Link
          href={connectHref}
          className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
        >
          {connectLabel}
        </Link>
        <form action={dismissSuggestionAction}>
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="surface" value={surface} />
          <input type="hidden" name="revalidate" value={revalidatePath} />
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            Dismiss
          </button>
        </form>
      </div>
    </div>
  );
}
