"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";

const channelSchema = z.enum(["push", "digest", "in_app"]);

const inputSchema = z.object({
  digestEnabled: z.boolean(),
  digestHourLocal: z.number().int().min(0).max(23),
  undoWindowSeconds: z.number().int().min(10).max(60),
  highRiskNotifyImmediate: z.boolean(),
  // Wave 2 — per-archetype notification routing. Optional so existing
  // callers that only persist the older fields still work; the matrix
  // is always merged into the JSONB blob (never overwritten) so other
  // preferences (theme, locale, voice trigger) survive.
  notificationTiers: z
    .object({
      A: channelSchema,
      B: channelSchema,
      C: channelSchema,
      D: channelSchema,
      E: channelSchema,
    })
    .optional(),
});

export async function saveNotificationSettingsAction(raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const args = inputSchema.parse(raw);
  const now = new Date();

  let mergedPreferences: typeof users.$inferSelect.preferences | undefined;
  if (args.notificationTiers) {
    const [row] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const existing = (row?.preferences ?? {}) as Record<string, unknown>;
    mergedPreferences = {
      ...existing,
      notificationTiers: args.notificationTiers,
    } as typeof users.$inferSelect.preferences;
  }

  await db
    .update(users)
    .set({
      digestEnabled: args.digestEnabled,
      digestHourLocal: args.digestHourLocal,
      undoWindowSeconds: args.undoWindowSeconds,
      highRiskNotifyImmediate: args.highRiskNotifyImmediate,
      ...(mergedPreferences ? { preferences: mergedPreferences } : {}),
      updatedAt: now,
    })
    .where(eq(users.id, session.user.id));
}
