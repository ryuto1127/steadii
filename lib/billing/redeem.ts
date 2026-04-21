import "server-only";
import { db } from "@/lib/db/client";
import { redeemCodes, redemptions, auditLog } from "@/lib/db/schema";
import { and, eq, gt, lt, isNull, sql } from "drizzle-orm";
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
        | "ALREADY_REDEEMED"
        | "RATE_LIMITED";
      message: string;
    };

const FAILED_ATTEMPTS_WINDOW_MS = 60 * 60 * 1000;
const FAILED_ATTEMPTS_LIMIT = 5;

async function recordFailedAttempt(
  userId: string,
  code: string,
  reason: string
): Promise<void> {
  const redacted = code.length > 8 ? `${code.slice(0, 8)}...` : code;
  await db.insert(auditLog).values({
    userId,
    action: "redeem.failed",
    resourceType: "redeem_code",
    resourceId: redacted,
    result: "failure",
    detail: { reason },
  });
}

export async function countRecentFailedRedeemAttempts(
  userId: string,
  withinMs: number = FAILED_ATTEMPTS_WINDOW_MS
): Promise<number> {
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.action, "redeem.failed"),
        gt(auditLog.createdAt, since)
      )
    );
  return rows.length;
}

export async function redeemCode(args: {
  userId: string;
  code: string;
}): Promise<RedeemOutcome> {
  const normalized = args.code.trim();
  if (!normalized) {
    await recordFailedAttempt(args.userId, "", "empty");
    return { ok: false, code: "NOT_FOUND", message: "Code is empty." };
  }

  const failedAttempts = await countRecentFailedRedeemAttempts(args.userId);
  if (failedAttempts >= FAILED_ATTEMPTS_LIMIT) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many attempts. Try again in an hour.",
    };
  }

  const [record] = await db
    .select()
    .from(redeemCodes)
    .where(eq(redeemCodes.code, normalized))
    .limit(1);

  if (!record) {
    await recordFailedAttempt(args.userId, normalized, "not_found");
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "That code isn't valid.",
    };
  }
  if (record.disabledAt) {
    await recordFailedAttempt(args.userId, normalized, "disabled");
    return { ok: false, code: "DISABLED", message: "This code has been disabled." };
  }
  const now = new Date();
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    await recordFailedAttempt(args.userId, normalized, "expired");
    return { ok: false, code: "EXPIRED", message: "This code has expired." };
  }

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
    await recordFailedAttempt(args.userId, normalized, "already_redeemed");
    return {
      ok: false,
      code: "ALREADY_REDEEMED",
      message: "You've already redeemed this code.",
    };
  }

  // Atomic claim: only increment if usesCount is still below maxUses AND the
  // code hasn't been disabled since we read it. This closes the TOCTOU race
  // where two concurrent requests could both pass a check-then-increment.
  const claimed = await db
    .update(redeemCodes)
    .set({ usesCount: sql`${redeemCodes.usesCount} + 1` })
    .where(
      and(
        eq(redeemCodes.id, record.id),
        lt(redeemCodes.usesCount, redeemCodes.maxUses),
        isNull(redeemCodes.disabledAt)
      )
    )
    .returning({ id: redeemCodes.id });

  if (!claimed.length) {
    await recordFailedAttempt(args.userId, normalized, "exhausted");
    return {
      ok: false,
      code: "EXHAUSTED",
      message: "This code has already been used up.",
    };
  }

  const effectiveUntil = new Date(
    now.getTime() + record.durationDays * 24 * 60 * 60 * 1000
  );

  try {
    await db.insert(redemptions).values({
      userId: args.userId,
      codeId: record.id,
      effectiveUntil,
    });
  } catch (err) {
    // Roll back the claim so the slot isn't silently consumed.
    await db
      .update(redeemCodes)
      .set({ usesCount: sql`${redeemCodes.usesCount} - 1` })
      .where(eq(redeemCodes.id, record.id));
    throw err;
  }

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
