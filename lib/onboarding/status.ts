import "server-only";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  accounts,
  users,
  icalSubscriptions,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
export { isOnboardingComplete } from "./is-complete";
import type { OnboardingStatus } from "./is-complete";
export type { OnboardingStatus };

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);

  const googleAcct = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);

  const scope = googleAcct[0]?.scope ?? "";
  const calendarConnected = scope.includes("calendar");
  const gmailConnected = scope.includes("gmail");

  // Step 2 is considered resolved if EITHER the user clicked Skip OR they
  // already have an optional integration linked. The latter check covers
  // the path where a returning user connected MS / iCal / Notion before
  // the integrations step shipped — they shouldn't be forced through it.
  const [userRow] = await db
    .select({
      onboardingIntegrationsSkippedAt: users.onboardingIntegrationsSkippedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let integrationsStepCompleted = !!userRow?.onboardingIntegrationsSkippedAt;
  if (!integrationsStepCompleted) {
    if (conn) integrationsStepCompleted = true;
    else {
      const [ms] = await db
        .select({ id: accounts.providerAccountId })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.provider, "microsoft-entra-id")
          )
        )
        .limit(1);
      if (ms) integrationsStepCompleted = true;
      else {
        const [ical] = await db
          .select({ id: icalSubscriptions.id })
          .from(icalSubscriptions)
          .where(eq(icalSubscriptions.userId, userId))
          .limit(1);
        if (ical) integrationsStepCompleted = true;
      }
    }
  }

  return {
    notionConnected: !!conn,
    notionSetupComplete: !!(conn && conn.setupCompletedAt),
    calendarConnected,
    gmailConnected,
    integrationsStepCompleted,
  };
}
