import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import {
  users,
  usageEvents,
  redeemCodes,
  redemptions,
  subscriptions,
} from "@/lib/db/schema";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";
import { count, sum, gt, desc, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = await isUnlimitedPlan(session.user.id);
  if (!isAdmin) notFound();

  const [userCountRow] = await db
    .select({ n: count(users.id) })
    .from(users)
    .where(isNull(users.deletedAt));

  const [usageRow] = await db
    .select({
      credits: sum(usageEvents.creditsUsed),
      input: sum(usageEvents.inputTokens),
      output: sum(usageEvents.outputTokens),
    })
    .from(usageEvents)
    .where(gt(usageEvents.createdAt, firstOfMonth()));

  const topUsers = await db
    .select({
      userId: usageEvents.userId,
      credits: sum(usageEvents.creditsUsed),
    })
    .from(usageEvents)
    .where(gt(usageEvents.createdAt, firstOfMonth()))
    .groupBy(usageEvents.userId)
    .orderBy(desc(sum(usageEvents.creditsUsed)))
    .limit(10);

  const activeCodes = await db
    .select()
    .from(redeemCodes)
    .where(isNull(redeemCodes.disabledAt))
    .orderBy(desc(redeemCodes.createdAt))
    .limit(50);

  const recentRedemptions = await db
    .select({
      redemption: redemptions,
      code: redeemCodes,
    })
    .from(redemptions)
    .innerJoin(redeemCodes, eq(redemptions.codeId, redeemCodes.id))
    .orderBy(desc(redemptions.redeemedAt))
    .limit(20);

  const activeSubs = await db
    .select({ n: count(subscriptions.id) })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">Admin</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Visible only while you hold an active admin redemption.
      </p>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat label="Users" value={String(userCountRow?.n ?? 0)} />
        <Stat
          label="Credits (this month)"
          value={String(usageRow?.credits ?? 0)}
        />
        <Stat
          label="Input tokens (this month)"
          value={String(usageRow?.input ?? 0)}
        />
        <Stat label="Active Stripe subs" value={String(activeSubs[0]?.n ?? 0)} />
      </section>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Top users by credits (this month)</h2>
        {topUsers.length === 0 ? (
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            No usage this month yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[hsl(var(--border))] text-sm">
            {topUsers.map((u) => (
              <li key={u.userId} className="flex justify-between py-2 font-mono text-xs">
                <span>{u.userId.slice(0, 8)}…</span>
                <span>{u.credits}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Active redeem codes</h2>
        {activeCodes.length === 0 ? (
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Generate with{" "}
            <code className="font-mono">pnpm tsx scripts/generate-redeem-code.ts</code>
            .
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[hsl(var(--border))] text-xs">
            {activeCodes.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="font-mono">{c.code}</span>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {c.type} · {c.durationDays}d · {c.usesCount}/{c.maxUses}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Recent redemptions</h2>
        {recentRedemptions.length === 0 ? (
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            No redemptions yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[hsl(var(--border))] text-xs">
            {recentRedemptions.map((r) => (
              <li key={r.redemption.id} className="flex justify-between py-2">
                <span className="font-mono">
                  {r.redemption.userId.slice(0, 8)}… · {r.code.type}
                </span>
                <span>
                  {r.redemption.redeemedAt.toLocaleDateString()} → active until{" "}
                  {r.redemption.effectiveUntil.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[hsl(var(--surface))] p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl">{value}</p>
    </div>
  );
}

function firstOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
