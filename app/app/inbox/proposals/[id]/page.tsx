import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, BellRing, Sparkles } from "lucide-react";
import { and, eq } from "drizzle-orm";
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
        <ArrowLeft size={12} /> Back to inbox
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
          {issueTypeLabel(row.issueType)}
        </span>
        {isResolved ? (
          <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {row.status === "resolved" ? "Resolved" : "Dismissed"}
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
          Why Steadii flagged this
        </h2>
        <p className="text-small leading-relaxed text-[hsl(var(--foreground))] whitespace-pre-wrap">
          {row.reasoning}
        </p>
      </section>

      {sourceRefs.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Sources
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
            What would you like to do?
          </h2>
          <ProposedActions
            proposalId={row.id}
            options={options}
            disabled={false}
          />
        </section>
      ) : (
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          This proposal is already {row.status}
          {row.resolvedAction ? ` (chose: ${row.resolvedAction})` : ""}.
        </p>
      )}
    </div>
  );
}

function issueTypeLabel(t: AgentProposalIssueType): string {
  switch (t) {
    case "time_conflict":
      return "Time conflict";
    case "exam_conflict":
      return "Exam conflict";
    case "deadline_during_travel":
      return "Deadline during travel";
    case "exam_under_prepared":
      return "Exam coming up";
    case "workload_over_capacity":
      return "Workload spike";
    case "syllabus_calendar_ambiguity":
      return "Confirm import";
    case "auto_action_log":
      return "Steadii action log";
  }
}

function issueTypeIcon(t: AgentProposalIssueType) {
  if (t === "auto_action_log")
    return <Sparkles size={11} strokeWidth={2.5} />;
  if (t === "syllabus_calendar_ambiguity")
    return <BellRing size={11} strokeWidth={2.5} />;
  return <AlertCircle size={11} strokeWidth={2.5} />;
}
