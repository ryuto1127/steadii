import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ConfirmationMode } from "./confirmation";

export async function getUserConfirmationMode(userId: string): Promise<ConfirmationMode> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const mode = row?.preferences?.agentConfirmationMode;
  if (mode === "all" || mode === "none" || mode === "destructive_only") return mode;
  return "destructive_only";
}

export async function setUserConfirmationMode(
  userId: string,
  mode: ConfirmationMode
): Promise<void> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const next = { ...(row?.preferences ?? {}), agentConfirmationMode: mode };
  await db
    .update(users)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
