import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { users, usageEvents, subscriptions } from "@/lib/db/schema";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";
import { count, sum, gt, desc, eq, isNull } from "drizzle-orm";
import { computeAgentMetrics } from "@/lib/agent/dogfood/metrics";

export const dynamic = "force-dynamic";

// Memory thresholds (project_agent_model.md, 2026-04-21):
// - draft edit rate < 20%
// - classification error rate < 5% (proxied by dismiss rate here)
// - regret rate = 0 (no signal yet — manual tracking for α)
const EDIT_RATE_TARGET = 20;
const DISMISS_RATE_TARGET = 5;

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

  const metrics = await computeAgentMetrics({ days: 7 });

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
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">
            Agent dogfood metrics ·{" "}
            <span className="text-[hsl(var(--muted-foreground))]">
              last {metrics.windowDays}d
            </span>
          </h2>
          <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            target edit&nbsp;&lt;{EDIT_RATE_TARGET}% · dismiss&nbsp;&lt;
            {DISMISS_RATE_TARGET}%
          </p>
        </div>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Aggregated across all users. W4 staged-autonomy gates open only
          when classification error and edit rate stay under target.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <RateStat
            label="Edit rate"
            value={metrics.editRatePct}
            target={EDIT_RATE_TARGET}
            denominator={metrics.reviewableDrafts}
          />
          <RateStat
            label="Dismiss rate"
            value={metrics.dismissRatePct}
            target={DISMISS_RATE_TARGET}
            denominator={metrics.reviewableDrafts}
          />
          <RateStat
            label="Send rate"
            value={metrics.sendRatePct}
            target={null}
            denominator={metrics.reviewableDrafts}
          />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <DistributionCard
            title="Inbox bucket (L1 result)"
            rows={metrics.bucketCounts.map((r) => ({
              label: r.bucket,
              count: r.count,
              pct: r.pct,
            }))}
            total={metrics.totalInbox}
            footer={
              <span>
                L2 referral{" "}
                <span className="font-mono">
                  {metrics.l2ReferralPct.toFixed(1)}%
                </span>{" "}
                {metrics.l2ReferralPct < 20 ? "✓" : "⚠ &gt;20% target"}
              </span>
            }
          />
          <DistributionCard
            title="Final risk_tier (post-L2)"
            rows={metrics.riskTierCounts.map((r) => ({
              label: r.tier,
              count: r.count,
              pct: r.pct,
            }))}
            total={metrics.totalInbox}
          />
          <DistributionCard
            title="agent_drafts.action"
            rows={metrics.actionCounts.map((r) => ({
              label: r.action,
              count: r.count,
              pct: r.pct,
            }))}
            total={metrics.totalDrafts}
          />
          <DistributionCard
            title="agent_drafts.status"
            rows={metrics.statusCounts.map((r) => ({
              label: r.status,
              count: r.count,
              pct: r.pct,
            }))}
            total={metrics.totalDrafts}
          />
        </div>

        <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
          Deep-pass retrieval ·{" "}
          <span className="font-mono">
            {metrics.highRiskWithRetrieval}/{metrics.highRiskDrafts}
          </span>{" "}
          high-risk drafts had retrieval · avg{" "}
          {metrics.avgRetrievalReturned.toFixed(1)} of{" "}
          {metrics.avgRetrievalCandidates.toFixed(1)} candidates returned.
        </p>
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

// `target=null` means there's no over/under threshold — the stat is
// informational (e.g. send rate, no upper bound).
function RateStat({
  label,
  value,
  target,
  denominator,
}: {
  label: string;
  value: number;
  target: number | null;
  denominator: number;
}) {
  const overTarget = target !== null && value > target;
  const tone = target === null
    ? ""
    : overTarget
      ? "text-[hsl(var(--destructive))]"
      : "text-[hsl(142_76%_36%)]";
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {label}
        </span>
        {target !== null ? (
          <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            target &lt;{target}%
          </span>
        ) : null}
      </div>
      <p className={`mt-2 font-mono text-2xl ${tone}`}>
        {value.toFixed(1)}%
      </p>
      <p className="mt-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
        n = {denominator}
      </p>
    </div>
  );
}

function DistributionCard({
  title,
  rows,
  total,
  footer,
}: {
  title: string;
  rows: Array<{ label: string; count: number; pct: number }>;
  total: number;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3">
      <p className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          (no data in window)
        </p>
      ) : (
        <ul className="mt-2 space-y-1 font-mono text-xs">
          {rows.map((r) => (
            <li key={r.label} className="flex items-baseline justify-between">
              <span>{r.label}</span>
              <span className="text-[hsl(var(--muted-foreground))]">
                {r.count} · {r.pct.toFixed(1)}%
              </span>
            </li>
          ))}
          <li className="flex items-baseline justify-between border-t border-[hsl(var(--border))] pt-1 text-[hsl(var(--muted-foreground))]">
            <span>total</span>
            <span>{total}</span>
          </li>
        </ul>
      )}
      {footer ? (
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {footer}
        </p>
      ) : null}
    </div>
  );
}

function firstOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
