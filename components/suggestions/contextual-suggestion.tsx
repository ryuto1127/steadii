import "server-only";
import { checkSuggestionEligibility } from "@/lib/integrations/suggestions/eligibility";
import { recordSuggestionImpression } from "@/lib/integrations/suggestions/impressions";
import {
  shouldShowIcalTrigger,
  shouldShowMsOutlookTrigger,
  shouldShowNotionImportTrigger,
} from "@/lib/integrations/suggestions/triggers";
import {
  type IntegrationSourceId,
  type SuggestionSurface,
} from "@/lib/db/schema";
import { InlineSuggestion } from "./inline-suggestion";

type Props = {
  userId: string;
  source: IntegrationSourceId;
  surface: SuggestionSurface;
  revalidatePath: string;
  variant?: "pill" | "card";
};

const COPY: Record<
  SuggestionSurface,
  { reason: string; href: string; cta: string }
> = {
  onboarding_step2: {
    reason: "",
    href: "/app/settings/connections",
    cta: "Open settings",
  },
  trigger_inbox_outlook: {
    reason:
      "We noticed mail from Microsoft 365 senders. Connect your Outlook calendar so Steadii can ground availability answers.",
    href: "/app/settings/connections",
    cta: "Connect Microsoft 365",
  },
  trigger_chat_ical: {
    reason:
      "Your chats are picking up — paste a school timetable iCal so Steadii can match deadlines to actual events.",
    href: "/app/settings/connections#ical",
    cta: "Add iCal feed",
  },
  trigger_mistakes_notion: {
    reason:
      "Plenty of chats but few notes saved here yet. If you have notes in Notion, import them into Steadii in one click.",
    href: "/app/settings/connections",
    cta: "Import from Notion",
  },
};

const TRIGGER_FN: Record<
  Exclude<SuggestionSurface, "onboarding_step2">,
  (userId: string) => Promise<boolean>
> = {
  trigger_inbox_outlook: shouldShowMsOutlookTrigger,
  trigger_chat_ical: shouldShowIcalTrigger,
  trigger_mistakes_notion: shouldShowNotionImportTrigger,
};

// Server-component wrapper that implements the full Surface 2 lifecycle
// for one of the contextual triggers. Returns null when the suggestion
// shouldn't render for any reason — eligibility cap, source already
// connected, or the trigger condition not met. Records exactly one
// impression per render so the 7-day cooldown stays accurate.
export async function ContextualSuggestion({
  userId,
  source,
  surface,
  revalidatePath,
  variant = "card",
}: Props) {
  if (surface === "onboarding_step2") {
    // Onboarding Step 2 records its own impressions inline; this component
    // is for Surface 2 only.
    return null;
  }

  const triggerFn = TRIGGER_FN[surface];
  if (!triggerFn) return null;

  const matches = await triggerFn(userId);
  if (!matches) return null;

  const { eligible } = await checkSuggestionEligibility(userId, source);
  if (!eligible) return null;

  await recordSuggestionImpression(userId, source, surface);

  const copy = COPY[surface];
  return (
    <InlineSuggestion
      source={source}
      surface={surface}
      revalidatePath={revalidatePath}
      connectHref={copy.href}
      connectLabel={copy.cta}
      reason={copy.reason}
      variant={variant}
    />
  );
}
