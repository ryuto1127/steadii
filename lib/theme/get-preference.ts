import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type ThemePreference = "light" | "dark" | "system";

export async function getUserThemePreference(
  userId: string
): Promise<ThemePreference> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const theme = row?.preferences?.theme;
  if (theme === "light" || theme === "dark" || theme === "system") return theme;
  return "system";
}

export async function setUserThemePreference(
  userId: string,
  theme: ThemePreference
): Promise<void> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = row?.preferences ?? {};
  await db
    .update(users)
    .set({ preferences: { ...current, theme }, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
