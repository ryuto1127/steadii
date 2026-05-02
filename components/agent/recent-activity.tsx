import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Activity, Archive, CheckCircle2, Mail, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db/client";
import { agentDrafts, agentProposals, auditLog } from "@/lib/db/schema";

// Recent activity footer — the Wave 2 audit log surface. Type-D queue
// cards (FYI / Steadii already did it) collapse into this footer per
// spec. Sources combined:
//
//   - agent_drafts where status='sent' or 'dismissed' (last 24h)
//   - agent_proposals where status='resolved' or issueType='auto_action_log'
//   - audit_log rows tagged with agent actions (auto-archives, etc.)
//
// We render up to 10 entries, newest first. The footer is always-visible
// when there's content; hidden when empty (no point taking up space
// when there's nothing to show).

const ACTIVITY_LIMIT = 10;

type ActivityRow = {
  id: string;
  occurredAt: Date;
  kind: ActivityKind;
  primary: string;
  detailHref?: string;
};

type ActivityKind =
  | "draft_sent"
  | "draft_dismissed"
  | "auto_archived"
  | "auto_replied"
  | "proposal_resolved"
  | "proposal_dismissed"
  | "calendar_imported"
  | "mistake_added"
  | "generic";

const KIND_ICON: Record<ActivityKind, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  draft_sent: Mail,
  draft_dismissed: X,
  auto_archived: Archive,
  auto_replied: Mail,
  proposal_resolved: CheckCircle2,
  proposal_dismissed: X,
  calendar_imported: Activity,
  mistake_added: Activity,
  generic: Activity,
};

export async function RecentActivity({ userId }: { userId: string }) {
  const t = await getTranslations("home_v2");
  const rows = await fetchActivity(userId);
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="recent-activity"
      className="mt-10 border-t border-[hsl(var(--border)/0.6)] pt-6"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h2
            id="recent-activity"
            className="text-[14px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]"
          >
            {t("activity_heading")}
          </h2>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("activity_caption")}
          </p>
        </div>
      </header>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind] ?? Activity;
          const verb = t(`activity_action_label.${row.kind}`);
          return (
            <li
              key={row.id}
              className="flex items-center gap-2.5 border-b border-[hsl(var(--border)/0.4)] py-1.5 text-[12px] last:border-b-0"
            >
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[hsl(var(--muted-foreground))]"
              >
                <Icon size={12} strokeWidth={1.75} />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {verb}
              </span>
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
                {row.primary}
              </span>
              <time
                dateTime={row.occurredAt.toISOString()}
                title={row.occurredAt.toLocaleString()}
                className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
              >
                {shortRelative(row.occurredAt)}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function fetchActivity(userId: string): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];

  // Resolved / dismissed proposals.
  try {
    const proposals = await db
      .select({
        id: agentProposals.id,
        issueType: agentProposals.issueType,
        issueSummary: agentProposals.issueSummary,
        status: agentProposals.status,
        resolvedAt: agentProposals.resolvedAt,
        createdAt: agentProposals.createdAt,
      })
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          inArray(agentProposals.status, ["resolved", "dismissed"])
        )
      )
      .orderBy(desc(agentProposals.resolvedAt))
      .limit(ACTIVITY_LIMIT);
    for (const p of proposals) {
      const ts = p.resolvedAt ?? p.createdAt;
      const kind: ActivityKind =
        p.issueType === "auto_action_log"
          ? "auto_archived"
          : p.status === "resolved"
            ? "proposal_resolved"
            : "proposal_dismissed";
      rows.push({
        id: `proposal:${p.id}`,
        occurredAt: ts,
        kind,
        primary: p.issueSummary,
        detailHref: `/app/inbox/proposals/${p.id}`,
      });
    }
  } catch {
    // proposals table missing — skip silently.
  }

  // Recent draft outcomes (sent / auto_sent / dismissed).
  const drafts = await db
    .select({
      id: agentDrafts.id,
      autoSent: agentDrafts.autoSent,
      status: agentDrafts.status,
      sentAt: agentDrafts.sentAt,
      updatedAt: agentDrafts.updatedAt,
      draftSubject: agentDrafts.draftSubject,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.status, ["sent", "dismissed"])
      )
    )
    .orderBy(desc(agentDrafts.updatedAt))
    .limit(ACTIVITY_LIMIT);
  for (const d of drafts) {
    const ts = d.sentAt ?? d.updatedAt;
    const kind: ActivityKind =
      d.status === "sent"
        ? d.autoSent
          ? "auto_replied"
          : "draft_sent"
        : "draft_dismissed";
    rows.push({
      id: `draft:${d.id}`,
      occurredAt: ts,
      kind,
      primary: d.draftSubject ?? "(no subject)",
      detailHref: `/app/inbox/${d.id}`,
    });
  }

  // Audit log entries — Steadii's silent calendar imports / autonomous
  // archives / etc. We pull a small recency window and filter to the
  // tags that surface as "things Steadii did".
  try {
    const audits = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        result: auditLog.result,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, userId),
          inArray(auditLog.action, [
            "calendar_event_imported",
            "syllabus_event_imported",
            "auto_archive",
            "mistake_note_saved",
          ])
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(ACTIVITY_LIMIT);
    for (const a of audits) {
      const kind: ActivityKind =
        a.action === "calendar_event_imported" ||
        a.action === "syllabus_event_imported"
          ? "calendar_imported"
          : a.action === "auto_archive"
            ? "auto_archived"
            : a.action === "mistake_note_saved"
              ? "mistake_added"
              : "generic";
      const detail =
        typeof a.detail === "object" && a.detail !== null
          ? (a.detail as Record<string, unknown>)
          : null;
      const primary =
        (detail?.summary as string | undefined) ??
        (detail?.title as string | undefined) ??
        a.action.replace(/_/g, " ");
      rows.push({
        id: `audit:${a.id}`,
        occurredAt: a.createdAt,
        kind,
        primary,
      });
    }
  } catch {
    // audit_log table or column drift — degrade silently.
  }

  // Soft-delete reference (drafts / proposals already filter; audit_log
  // has no soft-delete column today).
  void isNull;

  rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return rows.slice(0, ACTIVITY_LIMIT);
}

function shortRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
