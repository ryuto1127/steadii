import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getCreditBalance } from "@/lib/billing/credits";
import { getStorageTotals } from "@/lib/billing/storage";
import { prettyBytes } from "@/lib/billing/plan";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import { listUserRedemptions } from "@/lib/billing/redeem";
import { BillingActions } from "@/components/billing/billing-actions";
import { RedeemForm } from "@/components/billing/redeem-form";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; canceled?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { session_id, canceled } = await searchParams;

  const balance = await getCreditBalance(userId);
  const storage = await getStorageTotals(userId);
  const effective = await getEffectivePlan(userId);
  const redemptions = await listUserRedemptions(userId);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl">Billing</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Stripe is in test mode for α. Charges won&apos;t post; subscription
        state still round-trips.
      </p>

      {session_id && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm">
          Checkout session completed. Your plan will update within a few
          seconds (via the Stripe webhook).
        </div>
      )}
      {canceled && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          Checkout canceled. No change.
        </div>
      )}

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Current plan</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {effective.plan === "admin"
            ? `Admin (redemption) · active until ${effective.until.toLocaleDateString()}`
            : effective.plan === "pro" && effective.source === "stripe"
            ? `Pro (Stripe)${
                effective.until
                  ? ` · renews ${effective.until.toLocaleDateString()}`
                  : ""
              }`
            : effective.plan === "pro" && effective.source === "friend_redemption"
            ? `Pro (friend redemption) · active until ${effective.until.toLocaleDateString()}`
            : "Free"}
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>Credits this month</span>
            <span className="font-mono text-xs">
              {balance.used} / {balance.limit}
              {effective.plan === "admin" && (
                <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                  (unlimited)
                </span>
              )}
            </span>
          </div>
          <Bar
            percent={Math.min(100, (balance.used / balance.limit) * 100)}
            tone={
              effective.plan === "admin"
                ? "primary"
                : balance.exceeded
                ? "destructive"
                : balance.nearLimit
                ? "accent"
                : "primary"
            }
          />
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>Storage</span>
            <span className="font-mono text-xs">
              {prettyBytes(storage.usedBytes)} /{" "}
              {prettyBytes(storage.maxTotalBytes)}
            </span>
          </div>
          <Bar
            percent={Math.min(
              100,
              (storage.usedBytes / storage.maxTotalBytes) * 100
            )}
            tone={
              storage.usedBytes >= storage.maxTotalBytes
                ? "destructive"
                : storage.usedBytes >= storage.maxTotalBytes * 0.8
                ? "accent"
                : "primary"
            }
          />
        </div>
      </section>

      <BillingActions effectivePlan={effective.plan} />

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Redeem a code</h2>
        <RedeemForm />
        {redemptions.length > 0 && (
          <ul className="mt-6 space-y-2 text-xs text-[hsl(var(--muted-foreground))]">
            {redemptions.map((r) => (
              <li key={r.redemption.id} className="flex justify-between">
                <span>
                  {r.code.type} · {r.code.durationDays} days · redeemed{" "}
                  {r.redemption.redeemedAt.toLocaleDateString()}
                </span>
                <span>
                  {r.redemption.effectiveUntil.getTime() > Date.now()
                    ? `active until ${r.redemption.effectiveUntil.toLocaleDateString()}`
                    : `expired ${r.redemption.effectiveUntil.toLocaleDateString()}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Bar({
  percent,
  tone,
}: {
  percent: number;
  tone: "primary" | "accent" | "destructive";
}) {
  const color =
    tone === "destructive"
      ? "hsl(var(--destructive))"
      : tone === "accent"
      ? "hsl(var(--accent))"
      : "hsl(var(--primary))";
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--surface-raised))]">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}
