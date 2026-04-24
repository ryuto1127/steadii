"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";

const inputSchema = z.object({
  digestEnabled: z.boolean(),
  digestHourLocal: z.number().int().min(0).max(23),
  undoWindowSeconds: z.number().int().min(10).max(60),
  highRiskNotifyImmediate: z.boolean(),
});

export async function saveNotificationSettingsAction(raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const args = inputSchema.parse(raw);
  const now = new Date();
  await db
    .update(users)
    .set({
      digestEnabled: args.digestEnabled,
      digestHourLocal: args.digestHourLocal,
      undoWindowSeconds: args.undoWindowSeconds,
      highRiskNotifyImmediate: args.highRiskNotifyImmediate,
      updatedAt: now,
    })
    .where(eq(users.id, session.user.id));
}
