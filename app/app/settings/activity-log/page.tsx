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
} from "@/lib/db/schema";

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
  value: number;
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
