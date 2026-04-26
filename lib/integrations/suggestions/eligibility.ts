import "server-only";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  integrationSuggestionDismissals,
  integrationSuggestionImpressions,
  type IntegrationSourceId,
} from "@/lib/db/schema";
import { isSourceConnected } from "./sources";

// Locked decision Q4: per (user, source) cap is one impression per 7 days.
export const SUGGESTION_IMPRESSION_COOLDOWN_DAYS = 7;
// Locked decision Q4: 3 dismissals on the same source = permanent suppression.
export const SUGGESTION_DISMISSAL_LIMIT = 3;

export type EligibilityReason =
  | "eligible"
  | "already_connected"
  | "dismissed_permanently"
  | "in_cooldown_window";

export async function checkSuggestionEligibility(
  userId: string,
  source: IntegrationSourceId
): Promise<{ eligible: boolean; reason: EligibilityReason }> {
  // 1. Connected? Connecting clears the source from all paths (Q4 last clause).
  if (await isSourceConnected(userId, source)) {
    return { eligible: false, reason: "already_connected" };
  }

  // 2. Dismissed past the limit? Permanent suppression.
  const [{ value: dismissals }] = await db
    .select({ value: count() })
    .from(integrationSuggestionDismissals)
    .where(
      and(
        eq(integrationSuggestionDismissals.userId, userId),
        eq(integrationSuggestionDismissals.source, source)
      )
    );
  if (dismissals >= SUGGESTION_DISMISSAL_LIMIT) {
    return { eligible: false, reason: "dismissed_permanently" };
  }

  // 3. In the 7-day cooldown window from the most recent impression?
  const cooldownStart = new Date(
    Date.now() -
      SUGGESTION_IMPRESSION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  );
  const [recent] = await db
    .select({ shownAt: integrationSuggestionImpressions.shownAt })
    .from(integrationSuggestionImpressions)
    .where(
      and(
        eq(integrationSuggestionImpressions.userId, userId),
        eq(integrationSuggestionImpressions.source, source),
        gte(integrationSuggestionImpressions.shownAt, cooldownStart)
      )
    )
    .orderBy(desc(integrationSuggestionImpressions.shownAt))
    .limit(1);
  if (recent) {
    return { eligible: false, reason: "in_cooldown_window" };
  }

  return { eligible: true, reason: "eligible" };
}
