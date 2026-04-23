import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { OnboardingStatus } from "./is-complete";

export type OnboardingStepNumber = 1 | 2 | 3 | 4;

// Derive the step a user is on from their status. Steps (Phase 6, option B):
//   1. Connect Google (single consent — Calendar + Gmail)
//   2. (Optional) Connect Notion
//   3. (Only if Notion connected) Auto-setup: create parent + 4 databases
//   4. (Optional) Register existing Notion resources
//
// Notion is optional, so Step 2 is skippable. `persistedStep >= 2` from the
// users table is used as the "user has seen / skipped the Notion step"
// signal, letting us advance past it even when Notion isn't connected.
export function stepFromStatus(
  status: OnboardingStatus,
  persistedStep: number = 0
): OnboardingStepNumber {
  if (!status.gmailConnected || !status.calendarConnected) return 1;
  if (!status.notionConnected && persistedStep < 2) return 2;
  if (status.notionConnected && !status.notionSetupComplete) return 3;
  if (status.notionConnected && persistedStep < 4) return 4;
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
