import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, AlertTriangle, Pause } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentRules,
  inboxItems,
  users,
} from "@/lib/db/schema";
import { ThinkingBar } from "@/components/agent/thinking-bar";
import { ReasoningPanel } from "@/components/agent/reasoning-panel";
import { DraftActions } from "@/components/agent/draft-actions";
import { RolePickerDialog } from "@/components/agent/role-picker-dialog";

export const dynamic = "force-dynamic";

function riskTone(tier: "low" | "medium" | "high" | null): string {
  switch (tier) {
    case "high":
      return "text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)]";
    case "medium":
      return "text-[hsl(38_92%_40%)] bg-[hsl(38_92%_50%/0.12)]";
    case "low":
      return "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]";
    default:
      return "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]";
  }
}

function riskLabel(tier: "low" | "medium" | "high" | null): string {
  if (tier === "high") return "High";
  if (tier === "medium") return "Medium";
  if (tier === "low") return "Low";
  return "Classifying";
}

function actionLabel(
  action:
    | "draft_reply"
    | "archive"
    | "snooze"
    | "no_op"
    | "ask_clarifying"
    | "paused"
): string {
  switch (action) {
    case "draft_reply":
      return "Proposed: send reply";
    case "archive":
      return "Proposed: archive";
    case "snooze":
      return "Proposed: snooze";
    case "ask_clarifying":
      return "Proposed: ask clarifying question";
    case "no_op":
      return "No action needed";
    case "paused":
      return "Paused — credits exhausted";
  }
}

export default async function InboxItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [row] = await db
    .select({
      draft: agentDrafts,
      inbox: inboxItems,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) notFound();

  const [userRow] = await db
    .select({ undoWindowSeconds: users.undoWindowSeconds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const undoWindowSeconds = userRow?.undoWindowSeconds ?? 20;

  // Check if we should show the role picker (first-time sender AND no rule).
  let needsRolePick = false;
  if (row.inbox.firstTimeSender) {
    const existingRule = await db
      .select({ id: agentRules.id })
      .from(agentRules)
      .where(
        and(
          eq(agentRules.userId, userId),
          eq(agentRules.scope, "sender"),
          eq(
            agentRules.matchNormalized,
            row.inbox.senderEmail.toLowerCase()
          )
        )
      )
      .limit(1);
    needsRolePick = existingRule.length === 0;
  }

  const { draft, inbox } = row;
  const paused = draft.status === "paused";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-2">
      <div>
        <Link
          href="/app/inbox"
          className="inline-flex items-center gap-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Inbox
        </Link>
      </div>

      <header className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${riskTone(
              draft.riskTier
            )}`}
          >
            {riskLabel(draft.riskTier)}
          </span>
          {inbox.firstTimeSender ? (
            <span className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              New sender
            </span>
          ) : null}
          <span className="ml-auto text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
            {formatReceivedAt(inbox.receivedAt)}
          </span>
        </div>
        <h1 className="mt-2 text-h2 text-[hsl(var(--foreground))]">
          {inbox.subject ?? "(no subject)"}
        </h1>
        <div className="mt-1 flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
          <Mail size={14} strokeWidth={1.75} />
          <span>
            <span className="text-[hsl(var(--foreground))]">
              {inbox.senderName ?? inbox.senderEmail}
            </span>{" "}
            <span>&lt;{inbox.senderEmail}&gt;</span>
          </span>
        </div>
        {inbox.snippet ? (
          <p className="mt-3 rounded-md bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
            {inbox.snippet}
          </p>
        ) : null}
      </header>

      <ThinkingBar
        provenance={draft.retrievalProvenance}
        riskTier={draft.riskTier}
      />

      {paused ? (
        <div className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4 text-small">
          <Pause size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <div>
            <div className="font-medium text-[hsl(var(--foreground))]">
              Draft generation paused
            </div>
            <div className="mt-1 text-[hsl(var(--muted-foreground))]">
              You ran out of credits this cycle. Top up to resume draft
              generation — classification continues for free.
            </div>
            <Link
              href="/app/settings/billing"
              className="mt-2 inline-block text-[hsl(var(--primary))] hover:underline"
            >
              Manage billing →
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
          <AlertTriangle size={14} strokeWidth={1.75} />
          <span>{actionLabel(draft.action)}</span>
        </div>
      )}

      <ReasoningPanel reasoning={draft.reasoning} />

      {draft.action === "draft_reply" && !paused ? (
        <DraftActions
          draftId={draft.id}
          status={draft.status}
          action={draft.action}
          initialSubject={draft.draftSubject ?? ""}
          initialBody={draft.draftBody ?? ""}
          initialTo={draft.draftTo}
          initialCc={draft.draftCc}
          undoWindowSeconds={undoWindowSeconds}
        />
      ) : draft.action === "ask_clarifying" && !paused ? (
        <DraftActions
          draftId={draft.id}
          status={draft.status}
          action={draft.action}
          initialSubject=""
          initialBody=""
          initialTo={[]}
          initialCc={[]}
          undoWindowSeconds={undoWindowSeconds}
        />
      ) : null}

      {needsRolePick ? (
        <RolePickerDialog
          inboxItemId={inbox.id}
          senderEmail={inbox.senderEmail}
          senderName={inbox.senderName}
        />
      ) : null}
    </div>
  );
}

function formatReceivedAt(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
