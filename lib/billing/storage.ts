import "server-only";
import { db } from "@/lib/db/client";
import { blobAssets } from "@/lib/db/schema";
import { and, eq, isNull, sum } from "drizzle-orm";
import { getPlanLimits, type Plan } from "./plan";
import { prettyBytes } from "@/lib/format/bytes";

export type StorageTotals = {
  plan: Plan;
  usedBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export async function getStorageTotals(userId: string): Promise<StorageTotals> {
  const { plan, maxFileBytes, maxTotalBytes } = await getPlanLimits(userId);
  const [row] = await db
    .select({ total: sum(blobAssets.sizeBytes) })
    .from(blobAssets)
    .where(and(eq(blobAssets.userId, userId), isNull(blobAssets.deletedAt)));
  return {
    plan,
    usedBytes: Number(row?.total ?? 0),
    maxFileBytes,
    maxTotalBytes,
  };
}

export type UploadCheck =
  | { ok: true; plan: Plan; warning?: { message: string } }
  | {
      ok: false;
      code: "FILE_TOO_LARGE" | "STORAGE_EXCEEDED";
      plan: Plan;
      limitBytes: number;
      actualBytes: number;
      message: string;
    };

export async function checkUploadLimits(
  userId: string,
  sizeBytes: number
): Promise<UploadCheck> {
  const totals = await getStorageTotals(userId);

  if (sizeBytes > totals.maxFileBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      plan: totals.plan,
      limitBytes: totals.maxFileBytes,
      actualBytes: sizeBytes,
      message: `This file is ${prettyBytes(sizeBytes)}, above the ${prettyBytes(
        totals.maxFileBytes
      )} limit for the ${totals.plan} plan. ${
        totals.plan === "free"
          ? "Compress it or upgrade to Pro."
          : "Compress it or contact support."
      }`,
    };
  }

  const projected = totals.usedBytes + sizeBytes;
  if (projected > totals.maxTotalBytes) {
    if (totals.plan === "free") {
      return {
        ok: false,
        code: "STORAGE_EXCEEDED",
        plan: totals.plan,
        limitBytes: totals.maxTotalBytes,
        actualBytes: projected,
        message: `You're at ${prettyBytes(totals.usedBytes)} of ${prettyBytes(
          totals.maxTotalBytes
        )} — this upload would put you over the Free-plan storage limit. Upgrade to Pro or delete old files.`,
      };
    }
    // Pro users: allow, warn
    return {
      ok: true,
      plan: totals.plan,
      warning: {
        message: `You're over the ${prettyBytes(
          totals.maxTotalBytes
        )} soft cap (${prettyBytes(projected)} after this upload). Consider cleaning up old files.`,
      },
    };
  }

  return { ok: true, plan: totals.plan };
}
