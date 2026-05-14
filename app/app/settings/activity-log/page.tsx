import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import {
  agentDrafts,
  auditLog,
  messages,
  chats,
  usageEvents,
  users,
} from "@/lib/db/schema";
import { estimateUsdCost, pricingTierFor } from "@/lib/agent/models";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";

export const dynamic = "force-dynamic";

// engineer-48 — user-facing observability dashboard.
//
// Strategic motivation (from handoff doc): Steadii logs every L2 / chat
// / tool call to `audit_log`, but the user can't see it. "Steadii did X
// but I don't know why" is a trust killer at α. Human-EA research:
// regular check-ins where the assistant explains what they did this
// week is core to the trust relationship. This page is Steadii's
// version of that check-in.
//
// Privacy: the page reads only the signed-in user's own rows. No cross-
// user surface, no external transmission. Filter type / pagination are
// client-side for now; if data volume grows large enough that paging
// matters the next iteration can swap to server-side cursors.

const PAGE_SIZE = 20;

type ActivityRow = {
  id: string;
  createdAt: Date;
  action: string;
  resourceId: string | null;
  result: "success" | "failure";
  detail: unknown;
};

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("activity_log_page");

  const sp = await searchParams;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const tab = sp.tab === "failures" ? "failures" : "all";

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // engineer-59 — admin gate for cross-user spend visibility. Non-admin
  // users see only their own rollups; admin sees the per-user breakdown
  // section below. Mirrors the same `users.isAdmin` flag the /app/admin
  // pages gate on.
  const adminView = await isUnlimitedPlan(userId);

  // 7-day aggregates. Each is one cheap query; auditLog is well-indexed
  // by user_id + created_at via the implicit unique-id PK + foreign key.
  const [
    triagedCount,
    draftStats,
    chatTurns,
    proposalsShown,
    failuresCount,
    failureRows,
    activityRows,
    activityTotal,
  ] = await Promise.all([
    // emails ingested = inbox items where L2 ran
    db
      .select({ count: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, userId),
          eq(auditLog.action, "email_l2_completed"),
          gt(auditLog.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => r[0]?.count ?? 0),
    // drafts: generated / sent / auto-sent / dismissed
    db
      .select({
        total: count(),
        sent: sql<number>`COUNT(*) FILTER (WHERE ${agentDrafts.status} = 'sent')::int`,
        autoSent: sql<number>`COUNT(*) FILTER (WHERE ${agentDrafts.autoSent} = true)::int`,
        dismissed: sql<number>`COUNT(*) FILTER (WHERE ${agentDrafts.status} = 'dismissed')::int`,
      })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.userId, userId),
          gt(agentDrafts.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => r[0] ?? { total: 0, sent: 0, autoSent: 0, dismissed: 0 }),
    // chat turns = user-role messages in user's chats
    db
      .select({ count: count() })
      .from(messages)
      .innerJoin(chats, eq(chats.id, messages.chatId))
      .where(
        and(
          eq(chats.userId, userId),
          eq(messages.role, "user"),
          gt(messages.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => r[0]?.count ?? 0),
    // proactive proposals shown
    db
      .select({ count: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, userId),
          eq(auditLog.action, "proactive_proposal_shown"),
          gt(auditLog.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, userId),
          eq(auditLog.result, "failure"),
          gt(auditLog.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => r[0]?.count ?? 0),
    db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        resourceId: auditLog.resourceId,
        result: auditLog.result,
        detail: auditLog.detail,
      })
      .from(auditLog)
      .where(
        and(eq(auditLog.userId, userId), eq(auditLog.result, "failure"))
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(10),
    // Paginated activity feed. We don't filter on the row level for tab
    // here — the failures tab uses failureRows above, and "all" wants
    // the full mix.
    db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        resourceId: auditLog.resourceId,
        result: auditLog.result,
        detail: auditLog.detail,
      })
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(desc(auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
    db
      .select({ count: count() })
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .then((r) => r[0]?.count ?? 0),
  ]);

  const dismissedDrafts = draftStats.dismissed ?? 0;
  const sentDrafts = draftStats.sent ?? 0;
  const autoSent = draftStats.autoSent ?? 0;

  const totalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const showFailures = tab === "failures";

  // engineer-59 — cost telemetry. Pulls usage_events rows in three
  // windows (today / 7d / 30d) for the per-user rollups, plus the top-10
  // most expensive single calls, plus the per-taskType breakdown. Admin
  // additionally sees the per-user breakdown (top 10 spenders) so cross-
  // user spend regressions are visible without a script. All queries are
  // scoped to the signed-in user EXCEPT the admin per-user table.
  const costSelfWhere30d = and(
    eq(usageEvents.userId, userId),
    gt(usageEvents.createdAt, thirtyDaysAgo)
  );
  const costSelfRows30d = await db
    .select({
      id: usageEvents.id,
      chatId: usageEvents.chatId,
      model: usageEvents.model,
      taskType: usageEvents.taskType,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      cachedTokens: usageEvents.cachedTokens,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(costSelfWhere30d);

  const costSelfToday = costSelfRows30d.filter((r) => r.createdAt >= oneDayAgo);
  const costSelf7d = costSelfRows30d.filter((r) => r.createdAt >= sevenDaysAgo);

  const sumCost = (rows: typeof costSelfRows30d) =>
    rows.reduce(
      (s, r) =>
        s +
        estimateUsdCost(r.model, {
          input: r.inputTokens,
          output: r.outputTokens,
          cached: r.cachedTokens,
        }),
      0
    );
  const costTodayUsd = sumCost(costSelfToday);
  const cost7dUsd = sumCost(costSelf7d);
  const cost30dUsd = sumCost(costSelfRows30d);

  // Per-taskType for the 30d window.
  const byTaskMap = new Map<string, { calls: number; usd: number }>();
  for (const r of costSelfRows30d) {
    const usd = estimateUsdCost(r.model, {
      input: r.inputTokens,
      output: r.outputTokens,
      cached: r.cachedTokens,
    });
    const entry = byTaskMap.get(r.taskType) ?? { calls: 0, usd: 0 };
    entry.calls += 1;
    entry.usd += usd;
    byTaskMap.set(r.taskType, entry);
  }
  const byTaskRows = [...byTaskMap.entries()]
    .map(([taskType, v]) => ({ taskType, calls: v.calls, usd: v.usd }))
    .sort((a, b) => b.usd - a.usd);

  // Top 10 expensive single calls (30d).
  const topRuns = costSelfRows30d
    .map((r) => ({
      ...r,
      usd: estimateUsdCost(r.model, {
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedTokens,
      }),
    }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 10);

  // Admin-only: per-user breakdown over 30d. Joins to users for email
  // rendering. The query covers all users but pages stay scoped to
  // admin because the route gates on the `adminView` boolean above.
  type AdminUserRow = {
    userId: string;
    email: string | null;
    usd: number;
    calls: number;
  };
  let adminUserRows: AdminUserRow[] = [];
  if (adminView) {
    const allRecent = await db
      .select({
        userId: usageEvents.userId,
        model: usageEvents.model,
        inputTokens: usageEvents.inputTokens,
        outputTokens: usageEvents.outputTokens,
        cachedTokens: usageEvents.cachedTokens,
      })
      .from(usageEvents)
      .where(gt(usageEvents.createdAt, thirtyDaysAgo));
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users);
    const emailById = new Map<string, string | null>();
    for (const row of userRows) {
      emailById.set(row.id, row.email);
    }
    const tally = new Map<string, { usd: number; calls: number }>();
    for (const r of allRecent) {
      const u = estimateUsdCost(r.model, {
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedTokens,
      });
      const entry = tally.get(r.userId) ?? { usd: 0, calls: 0 };
      entry.usd += u;
      entry.calls += 1;
      tally.set(r.userId, entry);
    }
    adminUserRows = [...tally.entries()]
      .map(([id, v]) => ({
        userId: id,
        email: emailById.get(id) ?? null,
        usd: v.usd,
        calls: v.calls,
      }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ChevronLeft size={14} strokeWidth={1.75} />
          {t("settings_back")}
        </Link>
      </div>
      <header>
        <h1 className="text-h2 font-semibold">{t("title")}</h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("description")}
        </p>
      </header>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-body font-medium">{t("summary_heading")}</h2>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("summary_window")}
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SummaryStat
            label={t("stat_emails_triaged")}
            value={triagedCount}
          />
          <SummaryStat
            label={t("stat_drafts_generated")}
            value={draftStats.total}
            sub={t("stat_drafts_sub", {
              sent: sentDrafts,
              auto: autoSent,
              dismissed: dismissedDrafts,
            })}
          />
          <SummaryStat
            label={t("stat_chat_turns")}
            value={chatTurns}
          />
          <SummaryStat
            label={t("stat_proposals_shown")}
            value={proposalsShown}
          />
          <SummaryStat
            label={t("stat_failures")}
            value={failuresCount}
            tone={failuresCount > 0 ? "warn" : "neutral"}
          />
        </dl>
      </section>

      <CostSection
        costTodayUsd={costTodayUsd}
        cost7dUsd={cost7dUsd}
        cost30dUsd={cost30dUsd}
        byTaskRows={byTaskRows}
        topRuns={topRuns}
        adminView={adminView}
        adminUserRows={adminUserRows}
        labels={{
          heading: t("cost_heading"),
          description: t("cost_description"),
          today: t("cost_stat_today"),
          week: t("cost_stat_week"),
          month: t("cost_stat_month"),
          byTaskHeading: t("cost_by_task_heading"),
          callsLabel: (n: number) => t("cost_calls_label", { calls: n }),
          topRunsHeading: (n: number) =>
            t("cost_top_runs_heading", { count: n }),
          inLabel: t("cost_in_label"),
          outLabel: t("cost_out_label"),
          chatLink: t("cost_chat_link"),
          perUserHeading: t("cost_per_user_heading"),
        }}
      />

      <div className="flex gap-2 border-b border-[hsl(var(--border))]">
        <Link
          href="/app/settings/activity-log"
          className={`-mb-px border-b-2 px-3 py-2 text-small font-medium transition-hover ${
            !showFailures
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          {t("tab_recent")}
        </Link>
        <Link
          href="/app/settings/activity-log?tab=failures"
          className={`-mb-px border-b-2 px-3 py-2 text-small font-medium transition-hover ${
            showFailures
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          {t("tab_failures")}
        </Link>
      </div>

      {showFailures ? (
        <FailuresList rows={failureRows} emptyLabel={t("failures_empty")} />
      ) : (
        <ActivityList
          rows={activityRows}
          page={page}
          totalPages={totalPages}
          emptyLabel={t("activity_empty")}
          prevLabel={t("page_prev")}
          nextLabel={t("page_next")}
          pageLabel={t("page_label", { page: page + 1, total: totalPages })}
        />
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div
      className={
        tone === "warn"
          ? "rounded-md border border-[hsl(var(--destructive)/0.25)] bg-[hsl(var(--destructive)/0.05)] p-3"
          : "rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3"
      }
    >
      <dt className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="mt-0.5 text-h3 font-semibold tabular-nums text-[hsl(var(--foreground))]">
        {value}
      </dd>
      {sub ? (
        <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function ActivityList({
  rows,
  page,
  totalPages,
  emptyLabel,
  prevLabel,
  nextLabel,
  pageLabel,
}: {
  rows: ActivityRow[];
  page: number;
  totalPages: number;
  emptyLabel: string;
  prevLabel: string;
  nextLabel: string;
  pageLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center text-small text-[hsl(var(--muted-foreground))]">
        {emptyLabel}
      </div>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <ActivityRowItem key={r.id} row={r} />
        ))}
      </ul>
      <nav className="mt-2 flex items-center justify-between text-small text-[hsl(var(--muted-foreground))]">
        <Link
          href={
            page > 0
              ? `/app/settings/activity-log?page=${page - 1}`
              : "/app/settings/activity-log"
          }
          aria-disabled={page === 0}
          className={
            page === 0
              ? "pointer-events-none opacity-40"
              : "transition-hover hover:text-[hsl(var(--foreground))]"
          }
        >
          ← {prevLabel}
        </Link>
        <span className="font-mono text-[12px]">{pageLabel}</span>
        <Link
          href={
            page + 1 < totalPages
              ? `/app/settings/activity-log?page=${page + 1}`
              : "/app/settings/activity-log?page=" + page
          }
          aria-disabled={page + 1 >= totalPages}
          className={
            page + 1 >= totalPages
              ? "pointer-events-none opacity-40"
              : "transition-hover hover:text-[hsl(var(--foreground))]"
          }
        >
          {nextLabel} →
        </Link>
      </nav>
    </>
  );
}

function FailuresList({
  rows,
  emptyLabel,
}: {
  rows: ActivityRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center text-small text-[hsl(var(--muted-foreground))]">
        {emptyLabel}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <ActivityRowItem key={r.id} row={r} forcedTone="warn" />
      ))}
    </ul>
  );
}

function ActivityRowItem({
  row,
  forcedTone,
}: {
  row: ActivityRow;
  forcedTone?: "warn";
}) {
  const tone = forcedTone ?? (row.result === "failure" ? "warn" : "neutral");
  const detailSummary = summarizeDetail(row.detail);
  return (
    <li
      className={
        tone === "warn"
          ? "rounded-md border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.04)] p-3"
          : "rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-small font-medium text-[hsl(var(--foreground))]">
            {prettyAction(row.action)}
          </div>
          {row.resourceId ? (
            <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] break-all font-mono">
              {row.resourceId}
            </div>
          ) : null}
        </div>
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide " +
            (row.result === "failure"
              ? "bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]"
              : "bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]")
          }
        >
          {row.result}
        </span>
      </div>
      <div className="mt-1 text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
        {formatStamp(row.createdAt)}
      </div>
      {detailSummary ? (
        <p className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))] break-words">
          {detailSummary}
        </p>
      ) : null}
    </li>
  );
}

// Action strings come from audit_log.action — keep them readable
// without breaking the existing snake_case storage.
function prettyAction(a: string): string {
  return a.replace(/_/g, " ");
}

// Conservative detail rendering: stringify but cap so a payload bomb
// doesn't blow up the layout.
function summarizeDetail(d: unknown): string | null {
  if (d == null) return null;
  try {
    const s = JSON.stringify(d);
    if (s.length <= 200) return s;
    return s.slice(0, 199) + "…";
  } catch {
    return null;
  }
}

function formatStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

// engineer-59 — cost telemetry section. Renders today / 7d / 30d rollups,
// per-taskType breakdown, top-10 expensive single calls, and (admin
// only) the per-user breakdown. Pure server-component — all data is
// already aggregated above.
function formatUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}

function CostSection({
  costTodayUsd,
  cost7dUsd,
  cost30dUsd,
  byTaskRows,
  topRuns,
  adminView,
  adminUserRows,
  labels,
}: {
  costTodayUsd: number;
  cost7dUsd: number;
  cost30dUsd: number;
  byTaskRows: Array<{ taskType: string; calls: number; usd: number }>;
  topRuns: Array<{
    id: string;
    chatId: string | null;
    taskType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    usd: number;
    createdAt: Date;
  }>;
  adminView: boolean;
  adminUserRows: Array<{
    userId: string;
    email: string | null;
    usd: number;
    calls: number;
  }>;
  labels: {
    heading: string;
    description: string;
    today: string;
    week: string;
    month: string;
    byTaskHeading: string;
    callsLabel: (n: number) => string;
    topRunsHeading: (n: number) => string;
    inLabel: string;
    outLabel: string;
    chatLink: string;
    perUserHeading: string;
  };
}) {
  const taskTotal = byTaskRows.reduce((s, r) => s + r.usd, 0) || 1;
  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="text-body font-medium">{labels.heading}</h2>
      <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
        {labels.description}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryStat label={labels.today} value={formatUsd(costTodayUsd)} />
        <SummaryStat label={labels.week} value={formatUsd(cost7dUsd)} />
        <SummaryStat label={labels.month} value={formatUsd(cost30dUsd)} />
      </dl>

      {byTaskRows.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-small font-medium">{labels.byTaskHeading}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {byTaskRows.map((r) => {
              const share = (r.usd / taskTotal) * 100;
              return (
                <li
                  key={r.taskType}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-small"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-[hsl(var(--foreground))]">
                      {r.taskType}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[hsl(var(--border))]">
                      <div
                        className="h-full bg-[hsl(var(--primary))]"
                        style={{ width: `${Math.min(100, share)}%` }}
                      />
                    </div>
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {labels.callsLabel(r.calls)}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--foreground))]">
                    {formatUsd(r.usd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {topRuns.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-small font-medium">
            {labels.topRunsHeading(topRuns.length)}
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {topRuns.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-small"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[12px] text-[hsl(var(--foreground))]">
                    {r.taskType}{" "}
                    <span className="text-[hsl(var(--muted-foreground))]">
                      · {r.model}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                    {labels.inLabel} {r.inputTokens.toLocaleString()} ·{" "}
                    {labels.outLabel} {r.outputTokens.toLocaleString()} ·{" "}
                    {formatStamp(r.createdAt)}
                    {r.chatId ? (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          href={`/app/chat/${r.chatId}`}
                          className="underline transition-hover hover:text-[hsl(var(--foreground))]"
                        >
                          {labels.chatLink}
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
                <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--foreground))]">
                  {formatUsd(r.usd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adminView && adminUserRows.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-small font-medium">{labels.perUserHeading}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {adminUserRows.map((u) => (
              <li
                key={u.userId}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-small"
              >
                <div className="min-w-0 truncate font-mono text-[12px] text-[hsl(var(--foreground))]">
                  {u.email ?? u.userId}
                </div>
                <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                  {labels.callsLabel(u.calls)}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--foreground))]">
                  {formatUsd(u.usd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
