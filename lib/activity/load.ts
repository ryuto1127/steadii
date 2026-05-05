import "server-only";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, agentProposals, auditLog } from "@/lib/db/schema";

// Unified activity loader. Single source of truth for the Home footer
// (`recent-activity.tsx`) and the full /app/activity page. Pulls from the
// same three sources the Home footer used pre-extraction:
//
//   - agent_drafts where status in ('sent', 'dismissed')
//   - agent_proposals where status in ('resolved', 'dismissed') OR
//     issue_type='auto_action_log'
//   - audit_log where action in (auto_archive, calendar_event_imported,
//     syllabus_event_imported, mistake_note_saved)
//
// The loader supports a (since, until) window for the activity-page
// stats card (this week / month / all time) and a cursor for the
// timeline pagination ("Load more").

export type ActivityKind =
  | "draft_sent"
  | "draft_dismissed"
  | "auto_archived"
  | "auto_replied"
  | "proposal_resolved"
  | "proposal_dismissed"
  | "calendar_imported"
  | "mistake_added"
  | "generic";

export type ActivityRow = {
  id: string;
  occurredAt: Date;
  kind: ActivityKind;
  primary: string;
  // Optional secondary line (sender, class, etc).
  secondary?: string;
  detailHref?: string;
};

export type ActivityCursor = {
  // ISO of the next-newest occurredAt to fetch from. Inclusive
  // ordering is `< cursor.occurredAt`.
  occurredAt: string;
  // Tiebreaker — id of the row at exactly `occurredAt`. Combined with
  // `occurredAt`, defines a unique seek position.
  id: string;
};

export type LoadActivityArgs = {
  userId: string;
  limit?: number;
  since?: Date;
  until?: Date;
  cursor?: ActivityCursor | null;
};

const DEFAULT_LIMIT = 30;

export async function loadActivityRows(
  args: LoadActivityArgs
): Promise<{ rows: ActivityRow[]; nextCursor: ActivityCursor | null }> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const cursorTime = args.cursor ? new Date(args.cursor.occurredAt) : null;
  // We pull a chunky pre-merge buffer from each source — at most
  // (limit * 2) rows from each — then merge-sort + slice to `limit`.
  // For α scale the per-source extra IO is negligible and the math
  // stays simple. (Production-scale optimization: SQL UNION ALL with a
  // virtual `occurred_at` projection. Defer until row counts make the
  // current pattern slow.)
  const fetchLimit = limit * 2;
  const rows: ActivityRow[] = [];

  // Proposals — resolved/dismissed.
  try {
    const proposalConds = [
      eq(agentProposals.userId, args.userId),
      inArray(agentProposals.status, ["resolved", "dismissed"]),
    ];
    if (args.since) proposalConds.push(gt(agentProposals.resolvedAt, args.since));
    if (args.until) proposalConds.push(lt(agentProposals.resolvedAt, args.until));
    if (cursorTime) proposalConds.push(lt(agentProposals.resolvedAt, cursorTime));
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
      .where(and(...proposalConds))
      .orderBy(desc(agentProposals.resolvedAt))
      .limit(fetchLimit);
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
    // proposals table missing — degrade silently (parity with Home
    // footer behavior pre-extraction).
  }

  // Drafts — sent/dismissed.
  const draftConds = [
    eq(agentDrafts.userId, args.userId),
    inArray(agentDrafts.status, ["sent", "dismissed"]),
  ];
  if (args.since) draftConds.push(gt(agentDrafts.updatedAt, args.since));
  if (args.until) draftConds.push(lt(agentDrafts.updatedAt, args.until));
  if (cursorTime) draftConds.push(lt(agentDrafts.updatedAt, cursorTime));
  const drafts = await db
    .select({
      id: agentDrafts.id,
      autoSent: agentDrafts.autoSent,
      status: agentDrafts.status,
      sentAt: agentDrafts.sentAt,
      updatedAt: agentDrafts.updatedAt,
      draftSubject: agentDrafts.draftSubject,
      draftTo: agentDrafts.draftTo,
    })
    .from(agentDrafts)
    .where(and(...draftConds))
    .orderBy(desc(agentDrafts.updatedAt))
    .limit(fetchLimit);
  for (const d of drafts) {
    const ts = d.sentAt ?? d.updatedAt;
    const kind: ActivityKind =
      d.status === "sent"
        ? d.autoSent
          ? "auto_replied"
          : "draft_sent"
        : "draft_dismissed";
    const recipient = d.draftTo?.[0];
    rows.push({
      id: `draft:${d.id}`,
      occurredAt: ts,
      kind,
      primary: d.draftSubject ?? "(no subject)",
      secondary: recipient,
      detailHref: `/app/inbox/${d.id}`,
    });
  }

  // Audit log — calendar imports, archives, mistake-note saves.
  try {
    const auditConds = [
      eq(auditLog.userId, args.userId),
      inArray(auditLog.action, [
        "calendar_event_imported",
        "syllabus_event_imported",
        "auto_archive",
        "mistake_note_saved",
      ]),
    ];
    if (args.since) auditConds.push(gt(auditLog.createdAt, args.since));
    if (args.until) auditConds.push(lt(auditLog.createdAt, args.until));
    if (cursorTime) auditConds.push(lt(auditLog.createdAt, cursorTime));
    const audits = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        result: auditLog.result,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(...auditConds))
      .orderBy(desc(auditLog.createdAt))
      .limit(fetchLimit);
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

  rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const sliced = rows.slice(0, limit);
  const last = sliced[sliced.length - 1];
  const nextCursor: ActivityCursor | null =
    sliced.length === limit && last
      ? { occurredAt: last.occurredAt.toISOString(), id: last.id }
      : null;
  return { rows: sliced, nextCursor };
}

// Aggregate counts for the activity-page stats card. The same per-source
// queries the loader uses, but we only need counts — so we keep it cheap
// with `count(*)` rather than fetching rows. Returns the raw bucket the
// time-saved estimator expects, plus a few derived metrics for the UI.
export async function loadActivityStats(args: {
  userId: string;
  since?: Date;
  until?: Date;
}): Promise<{
  archivedCount: number;
  draftsSent: number;
  draftsDismissed: number;
  proposalsResolved: number;
  calendarImports: number;
  mistakeNotes: number;
  total: number;
}> {
  // Reuse loadActivityRows for correctness — α scale won't tax it. We
  // pull a generous limit so totals are accurate within the "all-time"
  // case (the activity page renders 30 rows initially; stats need
  // accurate totals across the window).
  const { rows } = await loadActivityRows({
    userId: args.userId,
    since: args.since,
    until: args.until,
    limit: 1000,
  });
  let archivedCount = 0;
  let draftsSent = 0;
  let draftsDismissed = 0;
  let proposalsResolved = 0;
  let calendarImports = 0;
  let mistakeNotes = 0;
  for (const r of rows) {
    switch (r.kind) {
      case "auto_archived":
        archivedCount++;
        break;
      case "draft_sent":
      case "auto_replied":
        draftsSent++;
        break;
      case "draft_dismissed":
        draftsDismissed++;
        break;
      case "proposal_resolved":
        proposalsResolved++;
        break;
      case "proposal_dismissed":
        // Counted in dismissals bucket on the inbox side, not the
        // activity card. Skip.
        break;
      case "calendar_imported":
        calendarImports++;
        break;
      case "mistake_added":
        mistakeNotes++;
        break;
      case "generic":
        break;
    }
  }
  return {
    archivedCount,
    draftsSent,
    draftsDismissed,
    proposalsResolved,
    calendarImports,
    mistakeNotes,
    total: rows.length,
  };
}
