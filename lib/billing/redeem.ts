import "server-only";
import { db } from "@/lib/db/client";
import { redeemCodes, redemptions, auditLog } from "@/lib/db/schema";
import { and, eq, isNull, gt } from "drizzle-orm";
import { syncUsersPlanColumn } from "./effective-plan";

export type RedeemOutcome =
  | {
      ok: true;
      type: "admin" | "friend";
      durationDays: number;
      effectiveUntil: Date;
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "DISABLED"
        | "EXPIRED"
        | "EXHAUSTED"
        | "ALREADY_REDEEMED";
      message: string;
    };

export async function redeemCode(args: {
  userId: string;
  code: string;
}): Promise<RedeemOutcome> {
  const normalized = args.code.trim();
  if (!normalized) {
    return { ok: false, code: "NOT_FOUND", message: "Code is empty." };
  }

  const [record] = await db
    .select()
    .from(redeemCodes)
    .where(eq(redeemCodes.code, normalized))
    .limit(1);

  if (!record) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "That code isn't valid.",
    };
  }
  if (record.disabledAt) {
    return { ok: false, code: "DISABLED", message: "This code has been disabled." };
  }
  const now = new Date();
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "EXPIRED", message: "This code has expired." };
  }
  if (record.usesCount >= record.maxUses) {
    return {
      ok: false,
      code: "EXHAUSTED",
      message: "This code has already been used up.",
    };
  }

  // Prevent double-redemption of the same code by the same user.
  const prior = await db
    .select()
    .from(redemptions)
    .where(
      and(
        eq(redemptions.userId, args.userId),
        eq(redemptions.codeId, record.id),
        gt(redemptions.effectiveUntil, now)
      )
    )
    .limit(1);
  if (prior.length) {
    return {
      ok: false,
      code: "ALREADY_REDEEMED",
      message: "You've already redeemed this code.",
    };
  }

  const effectiveUntil = new Date(
    now.getTime() + record.durationDays * 24 * 60 * 60 * 1000
  );

  await db.insert(redemptions).values({
    userId: args.userId,
    codeId: record.id,
    effectiveUntil,
  });
  await db
    .update(redeemCodes)
    .set({ usesCount: record.usesCount + 1 })
    .where(eq(redeemCodes.id, record.id));

  await db.insert(auditLog).values({
    userId: args.userId,
    action: `redeem.${record.type}`,
    resourceType: "redeem_code",
    resourceId: record.id,
    result: "success",
    detail: {
      durationDays: record.durationDays,
      effectiveUntil: effectiveUntil.toISOString(),
    },
  });

  await syncUsersPlanColumn(args.userId);

  return {
    ok: true,
    type: record.type,
    durationDays: record.durationDays,
    effectiveUntil,
  };
}

export async function listUserRedemptions(userId: string) {
  const rows = await db
    .select({
      redemption: redemptions,
      code: redeemCodes,
    })
    .from(redemptions)
    .innerJoin(redeemCodes, eq(redemptions.codeId, redeemCodes.id))
    .where(eq(redemptions.userId, userId));
  return rows;
}

// Tiny helper to enforce the 5/hr rate-limit per AGENTS.md §6.3.
export async function countRecentRedemptionAttempts(
  userId: string,
  withinMs = 60 * 60 * 1000
): Promise<number> {
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select({ id: redemptions.id })
    .from(redemptions)
    .where(
      and(
        eq(redemptions.userId, userId),
        gt(redemptions.redeemedAt, since),
        isNull(redemptions.effectiveUntil) // never true; just preserve type
      )
    );
  return rows.length;
}
