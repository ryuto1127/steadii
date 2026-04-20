import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { OnboardingStatus } from "./is-complete";

export type OnboardingStepNumber = 1 | 2 | 3 | 4;

// Derive the step a user is on from their status. Steps:
//   1. Connect Notion
//   2. Connect Google Calendar
//   3. Auto-setup (create parent + 4 databases)
//   4. Optional: register existing resources (can be skipped)
export function stepFromStatus(status: OnboardingStatus): OnboardingStepNumber {
  if (!status.notionConnected) return 1;
  if (!status.calendarConnected) return 2;
  if (!status.notionSetupComplete) return 3;
  return 4;
}

export async function persistOnboardingStep(
  userId: string,
  step: OnboardingStepNumber
): Promise<void> {
  const [row] = await db
    .select({ current: users.onboardingStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Only advance forward — don't regress a user who's flipped tabs.
  if (row && row.current < step) {
    await db
      .update(users)
      .set({ onboardingStep: step, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
}

export async function getPersistedOnboardingStep(
  userId: string
): Promise<OnboardingStepNumber> {
  const [row] = await db
    .select({ current: users.onboardingStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const n = row?.current ?? 0;
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}
