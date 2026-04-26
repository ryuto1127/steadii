import "server-only";
import { db } from "@/lib/db/client";
import {
  integrationSuggestionDismissals,
  integrationSuggestionImpressions,
  type IntegrationSourceId,
  type SuggestionSurface,
} from "@/lib/db/schema";

// Insert one impression row. Surfaces call this from a server component
// after deciding (via checkSuggestionEligibility) that the suggestion
// should render — the timing is "we're about to render," not "the user
// clicked." That keeps the cooldown logic computable from impressions
// alone without needing a "did the user actually see this?" beacon.
export async function recordSuggestionImpression(
  userId: string,
  source: IntegrationSourceId,
  surface: SuggestionSurface
): Promise<void> {
  await db.insert(integrationSuggestionImpressions).values({
    userId,
    source,
    surface,
  });
}

export async function recordSuggestionDismissal(
  userId: string,
  source: IntegrationSourceId,
  surface: SuggestionSurface
): Promise<void> {
  await db.insert(integrationSuggestionDismissals).values({
    userId,
    source,
    surface,
  });
}
