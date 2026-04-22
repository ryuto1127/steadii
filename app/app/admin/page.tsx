import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { users, usageEvents, subscriptions } from "@/lib/db/schema";
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

  const activeSubs = await db
    .select({ n: count(subscriptions.id) })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">Admin</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Visible only while your user row has is_admin=true.
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

      <section className="mt-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
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

      <section className="mt-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">Invite codes</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Friend invites are now Stripe Promotion Codes backed by the
          <code className="mx-1 rounded bg-[hsl(var(--surface-raised))] px-1 font-mono text-xs">
            FRIEND_3MO
          </code>
          coupon (100% off for 3 months). Create individual single-use
          codes in the Stripe Dashboard — no in-app issuance UI.
        </p>
        <a
          href="https://dashboard.stripe.com/test/coupons/STEADII_FRIEND_3MO"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm text-[hsl(var(--primary))] hover:underline"
        >
          Open coupon in Stripe Dashboard →
        </a>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
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
