import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isLocale, type Locale } from "@/lib/i18n/config";

export async function getUserLocalePreference(
  userId: string
): Promise<Locale | null> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const locale = row?.preferences?.locale;
  return isLocale(locale) ? locale : null;
}

export async function setUserLocalePreference(
  userId: string,
  locale: Locale
): Promise<void> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = row?.preferences ?? {};
  await db
    .update(users)
    .set({ preferences: { ...current, locale }, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
