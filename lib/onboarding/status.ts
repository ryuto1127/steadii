import "server-only";
import { db } from "@/lib/db/client";
import { notionConnections, accounts } from "@/lib/db/schema";
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

  return {
    notionConnected: !!conn,
    notionSetupComplete: !!(conn && conn.setupCompletedAt),
    calendarConnected,
    gmailConnected,
  };
}
