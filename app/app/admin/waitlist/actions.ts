"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { waitlistRequests } from "@/lib/db/schema";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";
import { env } from "@/lib/env";
import { createWaitlistPromotionCode } from "@/lib/waitlist/promotion-code";
import { sendAccessApprovedEmail } from "@/lib/waitlist/email";

export type ApprovalRowResult =
  | { id: string; ok: true }
  | { id: string; ok: false; error: string };

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");
  const isAdmin = await isUnlimitedPlan(session.user.id);
  if (!isAdmin) throw new Error("FORBIDDEN");
  return session.user.id;
}

// For each ID: flip status, generate Stripe promo code, send Resend email,
// stamp emailSentAt. Errors are captured per-row so one bad apple doesn't
// abort the batch.
export async function approveWaitlistAction(
  ids: string[]
): Promise<ApprovalRowResult[]> {
  const adminId = await requireAdmin();
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(waitlistRequests)
    .where(inArray(waitlistRequests.id, ids));

  const results: ApprovalRowResult[] = [];

  for (const row of rows) {
    try {
      // Skip rows that are already approved AND have an invite URL — the
      // admin probably double-clicked; idempotently report success.
      if (row.status === "approved" && row.inviteUrl) {
        results.push({ id: row.id, ok: true });
        continue;
      }

      const promo = await createWaitlistPromotionCode({
        email: row.email,
        name: row.name,
      });
      const inviteUrl = `${stripTrailingSlash(env().APP_URL)}/invite/${promo.code}`;

      const sent = await sendAccessApprovedEmail({
        to: row.email,
        name: row.name,
        inviteUrl,
      });

      await db
        .update(waitlistRequests)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedBy: adminId,
          stripePromotionCode: promo.code,
          inviteUrl,
          emailSentAt: sent ? new Date() : null,
        })
        .where(eq(waitlistRequests.id, row.id));

      results.push({ id: row.id, ok: true });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "waitlist_approve" },
        extra: { waitlistRequestId: row.id, email: row.email },
      });
      results.push({
        id: row.id,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  revalidatePath("/app/admin/waitlist");
  return results;
}

export async function denyWaitlistAction(ids: string[]): Promise<void> {
  await requireAdmin();
  if (ids.length === 0) return;
  await db
    .update(waitlistRequests)
    .set({ status: "denied", approvedAt: null })
    .where(inArray(waitlistRequests.id, ids));
  revalidatePath("/app/admin/waitlist");
}

export async function markGoogleSyncedAction(ids: string[]): Promise<void> {
  await requireAdmin();
  if (ids.length === 0) return;
  await db
    .update(waitlistRequests)
    .set({ googleTestUserAddedAt: new Date() })
    .where(inArray(waitlistRequests.id, ids));
  revalidatePath("/app/admin/waitlist");
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
