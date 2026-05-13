import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, BellRing, Sparkles } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  type ActionOption,
  type AgentProposalIssueType,
  type ProposalSourceRef,
} from "@/lib/db/schema";
import { ProposedActions } from "@/components/agent/proposed-actions";

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: proposalId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("agent.proposal_detail");
  const tDetail = await getTranslations("proposal_detail");

  const [row] = await db
    .select()
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.id, proposalId),
        eq(agentProposals.userId, userId)
      )
    )
    .limit(1);
  if (!row) notFound();

  // Mark as viewed on first open. Doesn't change status — the user
  // hasn't acted yet — but populates viewedAt so the row drops out of
  // the "unread" group on the inbox list.
  if (!row.viewedAt) {
    await db
      .update(agentProposals)
      .set({ viewedAt: new Date() })
      .where(eq(agentProposals.id, proposalId));
  }

  const options = row.actionOptions as ActionOption[];
  const sourceRefs = row.sourceRefs as ProposalSourceRef[];
  const isResolved = row.status !== "pending";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/app/inbox"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft size={12} /> {tDetail("back")}
      </Link>

      <div className="mb-4 flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${
            isResolved
              ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]"
              : "bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]"
          }`}
        >
          {issueTypeIcon(row.issueType)}
          {tDetail(issueTypeLabelKey(row.issueType))}
        </span>
        {isResolved ? (
          <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {row.status === "resolved"
              ? tDetail("status_resolved")
              : tDetail("status_dismissed")}
            {row.resolvedAt
              ? ` · ${row.resolvedAt.toISOString().slice(0, 10)}`
              : null}
          </span>
        ) : null}
      </div>

      <h1 className="mb-3 font-display text-[hsl(var(--foreground))]">
        {row.issueSummary}
      </h1>

      <section className="mb-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("why_flagged")}
        </h2>
        <p className="text-small leading-relaxed text-[hsl(var(--foreground))] whitespace-pre-wrap">
          {row.reasoning}
        </p>
      </section>

      {sourceRefs.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("sources")}
          </h2>
          <ul className="space-y-1 text-small">
            {sourceRefs.map((ref, i) => (
              <li key={`${ref.kind}-${ref.id}-${i}`}>
                <span className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mr-2">
                  {ref.kind.replace(/_/g, " ")}
                </span>
                <span className="text-[hsl(var(--foreground))]">
                  {ref.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!isResolved ? (
        <section className="mb-2">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {tDetail("what_to_do")}
          </h2>
          <ProposedActions
            proposalId={row.id}
            options={options}
            disabled={false}
          />
        </section>
      ) : (
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          {tDetail(alreadyStatusKey(row.status))}
          {row.resolvedAction
            ? tDetail("already_status_with_action", { action: row.resolvedAction })
            : ""}
          .
        </p>
      )}
    </div>
  );
}

function issueTypeLabelKey(t: AgentProposalIssueType): string {
  switch (t) {
    case "time_conflict":
      return "issue_time_conflict";
    case "exam_conflict":
      return "issue_exam_conflict";
    case "deadline_during_travel":
      return "issue_deadline_during_travel";
    case "exam_under_prepared":
      return "issue_exam_under_prepared";
    case "workload_over_capacity":
      return "issue_workload_over_capacity";
    case "syllabus_calendar_ambiguity":
      return "issue_syllabus_calendar_ambiguity";
    // engineer-43 — new types share the workload visual label; the
    // Inbox Proposal detail page doesn't currently surface these via
    // its own translations, so we fall back to the closest fit.
    case "classroom_deadline_imminent":
      return "issue_workload_over_capacity";
    case "calendar_double_booking":
      return "issue_time_conflict";
    // engineer-44 — no dedicated translation yet; fall back to workload
    // since the visual treatment (Type C / soft notice) is the same family.
    case "assignment_deadline_reminder":
      return "issue_workload_over_capacity";
    case "auto_action_log":
      return "issue_auto_action_log";
    case "admin_waitlist_pending":
      return "issue_admin_waitlist_pending";
    case "group_project_detected":
      return "issue_group_project_detected";
    case "group_member_silent":
      return "issue_group_member_silent";
    // engineer-48 — user_fact_review surfaces a re-confirmation card; no
    // dedicated translation yet (the queue card carries the fact text
    // inline). Fall back to syllabus_calendar_ambiguity which has the
    // same Type-F visual family.
    case "user_fact_review":
      return "issue_syllabus_calendar_ambiguity";
    // engineer-49 — monthly boundary check-in. No dedicated translation;
    // the card body carries the actual summary text inline. Fall back
    // to the workload-family label since the visual treatment matches.
    case "monthly_boundary_review":
      return "issue_workload_over_capacity";
    // engineer-51 — entity-graph cards. No dedicated translation yet;
    // both surface as Type C and share the workload-family label since
    // the visual treatment matches.
    case "entity_fading":
    case "entity_deadline_cluster":
      return "issue_workload_over_capacity";
  }
}

function alreadyStatusKey(status: string): string {
  if (status === "resolved") return "already_status_resolved";
  if (status === "dismissed") return "already_status_dismissed";
  return "already_status_pending";
}

function issueTypeIcon(t: AgentProposalIssueType) {
  if (t === "auto_action_log")
    return <Sparkles size={11} strokeWidth={2.5} />;
  if (t === "syllabus_calendar_ambiguity")
    return <BellRing size={11} strokeWidth={2.5} />;
  return <AlertCircle size={11} strokeWidth={2.5} />;
}
