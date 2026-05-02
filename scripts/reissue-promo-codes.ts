/**
 * scripts/reissue-promo-codes.ts
 *
 * One-shot retroactive promo code reissue for users approved BEFORE the
 * Stripe Live mode cutover. Test-mode Promotion Codes do not exist in
 * Live mode, so previously-approved users need fresh codes + a fresh
 * approval email.
 *
 * Usage (from .env.local + inline overrides):
 *   STRIPE_SECRET_KEY=sk_live_... APP_URL=https://mysteadii.com \
 *     pnpm tsx scripts/reissue-promo-codes.ts             # dry run
 *
 *   STRIPE_SECRET_KEY=sk_live_... APP_URL=https://mysteadii.com \
 *     pnpm tsx scripts/reissue-promo-codes.ts --apply     # actually do it
 *
 * Required env (read from .env.local unless overridden inline):
 *   DATABASE_URL              must point at production
 *   STRIPE_SECRET_KEY         must start with sk_live_
 *   STRIPE_COUPON_FRIEND_3MO  STEADII_FRIEND_3MO
 *   RESEND_API_KEY            live key (or emails silently skip)
 *   APP_URL                   https://mysteadii.com
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { waitlistRequests } from "@/lib/db/schema";
import { createWaitlistPromotionCode } from "@/lib/waitlist/promotion-code";
import { sendAccessApprovedEmail } from "@/lib/waitlist/email";
import { env } from "@/lib/env";

const DRY_RUN = !process.argv.includes("--apply");

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function main() {
  const sk = process.env.STRIPE_SECRET_KEY ?? "";
  const isLive = sk.startsWith("sk_live_");
  console.log(`\nStripe mode:  ${isLive ? "LIVE ✓" : "TEST ✗"} (${sk.slice(0, 12)}...)`);
  console.log(`APP_URL:      ${env().APP_URL}`);
  console.log(`Coupon:       ${env().STRIPE_COUPON_FRIEND_3MO || "(missing!)"}`);
  console.log(`Resend key:   ${process.env.RESEND_API_KEY ? "set" : "(missing — emails will skip)"}`);

  if (!isLive) {
    console.error("\nERROR: STRIPE_SECRET_KEY is not Live. Override inline:");
    console.error("  STRIPE_SECRET_KEY=sk_live_... pnpm tsx scripts/reissue-promo-codes.ts\n");
    process.exit(1);
  }
  if (!env().APP_URL.includes("mysteadii.com")) {
    console.warn(`\n⚠️  APP_URL doesn't look like production. Emails will link to "${env().APP_URL}". Continue? (Ctrl+C to abort, Enter to continue)`);
    if (!DRY_RUN) {
      await new Promise<void>((r) => process.stdin.once("data", () => r()));
    }
  }

  const rows = await db
    .select()
    .from(waitlistRequests)
    .where(eq(waitlistRequests.status, "approved"));

  console.log(`\nFound ${rows.length} approved waitlist row(s) to reissue.\n`);

  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const row of rows) {
    const code = row.stripePromotionCode ?? "(none)";
    const approvedAt = row.approvedAt?.toISOString().slice(0, 10) ?? "?";
    console.log(
      `  - ${row.email.padEnd(40)} | ${(row.name ?? "—").padEnd(24)} | approved ${approvedAt} | old code: ${code}`
    );
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes made. Re-run with --apply to reissue.\n");
    return;
  }

  console.log("\n=== applying ===\n");

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    try {
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
          stripePromotionCode: promo.code,
          inviteUrl,
          emailSentAt: sent ? new Date() : null,
        })
        .where(eq(waitlistRequests.id, row.id));

      console.log(
        `  ✓ ${row.email} → ${promo.code}${sent ? "" : " (email skipped — RESEND_API_KEY missing)"}`
      );
      ok++;
    } catch (err) {
      console.error(
        `  ✗ ${row.email}: ${err instanceof Error ? err.message : String(err)}`
      );
      fail++;
    }
  }

  console.log(`\nDone. ${ok} ok, ${fail} failed.\n`);
}

(async () => {
  try {
    await main();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
