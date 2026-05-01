import {
  Inbox as InboxIcon,
  HelpCircle,
  Star,
} from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  inboxItems,
  accounts,
  agentDrafts,
  agentProposals,
} from "@/lib/db/schema";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import {
  compareInboxRows,
  isPendingDraft,
} from "@/lib/agent/email/pending-queries";
import { SteadiiNoticedToggle } from "./_components/steadii-noticed-toggle";

export const dynamic = "force-dynamic";

function shortTime(d: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// The visible "tier" is the post-L2 risk_tier if populated, otherwise the
// L1 bucket (pre-L2 heuristic). L2 writes risk_tier back to inbox_items in
// both the success and paused paths, so after the pipeline runs the UI
// stops showing the stale "Classifying" label.
function tierFor(
  bucket: string,
  riskTier: "low" | "medium" | "high" | null
): "high" | "medium" | "low" | "classifying" | "ignore" | "unknown" {
  if (riskTier === "high") return "high";
  if (riskTier === "medium") return "medium";
  if (riskTier === "low") return "low";
  switch (bucket) {
    case "auto_high":
      return "high";
    case "auto_medium":
      return "medium";
    case "auto_low":
      return "low";
    case "l2_pending":
      return "classifying";
    case "ignore":
      return "ignore";
    default:
      return "unknown";
  }
}

function tierLabel(
  tier: ReturnType<typeof tierFor>,
  t: (key: string) => string
): string {
  switch (tier) {
    case "high":
      return t("tier_high");
    case "medium":
      return t("tier_medium");
    case "low":
      return t("tier_low");
    case "classifying":
      return t("tier_classifying");
    case "ignore":
      return t("tier_ignore");
    default:
      return "";
  }
}

function tierTone(tier: ReturnType<typeof tierFor>): string {
  switch (tier) {
    case "high":
      return "text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)]";
    case "medium":
      return "text-[hsl(38_92%_40%)] bg-[hsl(38_92%_50%/0.12)]";
    case "low":
      return "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]";
    case "classifying":
      return "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]";
    default:
      return "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]";
  }
}

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("inbox");

  // Gmail connectivity is a per-user signal: if the Google row lacks the
  // gmail scope, we can't triage anything yet. We nudge the user through
  // the re-auth banner on layout, but the Inbox page still shows a
  // dedicated empty state that calls it out directly.
  const [acct] = await db
    .select({ scope: accounts.scope })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  const gmailConnected = acct?.scope?.includes("gmail") ?? false;

  const rawItems = gmailConnected
    ? await db
        .select({
          id: inboxItems.id,
          senderEmail: inboxItems.senderEmail,
          senderName: inboxItems.senderName,
          subject: inboxItems.subject,
          snippet: inboxItems.snippet,
          receivedAt: inboxItems.receivedAt,
          bucket: inboxItems.bucket,
          riskTier: inboxItems.riskTier,
          firstTimeSender: inboxItems.firstTimeSender,
          // polish-7 — populated when the user opens the detail page.
          // Combined with `agentDraftStatus`/`action` to compute the
          // 3-state group key in compareInboxRows: pending → unread
          // non-pending → read non-pending.
          reviewedAt: inboxItems.reviewedAt,
          // Latest agent_draft for this inbox_item (NULL if not yet
          // processed). The inbox list deep-links into /app/inbox/[draftId]
          // — the review page's canonical URL — so the digest, bell, and
          // list all funnel through the same route.
          agentDraftId: agentDrafts.id,
          agentDraftCreatedAt: agentDrafts.createdAt,
          agentDraftStatus: agentDrafts.status,
          agentDraftAction: agentDrafts.action,
        })
        .from(inboxItems)
        .leftJoin(agentDrafts, eq(agentDrafts.inboxItemId, inboxItems.id))
        .where(
          and(
            eq(inboxItems.userId, userId),
            eq(inboxItems.status, "open"),
            isNull(inboxItems.deletedAt),
            // Hide ignore-bucket rows from the default view; they're
            // stored for analytics, not for user attention.
            ne(inboxItems.bucket, "ignore")
          )
        )
        .orderBy(desc(inboxItems.receivedAt))
        .limit(100)
    : [];

  // Dedupe inbox_items: if one has multiple drafts (future regen), keep
  // the newest. We picked the leftJoin over a subquery for Drizzle clarity.
  const seen = new Map<string, (typeof rawItems)[number]>();
  for (const r of rawItems) {
    const prev = seen.get(r.id);
    if (!prev) {
      seen.set(r.id, r);
      continue;
    }
    const prevTs = prev.agentDraftCreatedAt?.getTime() ?? 0;
    const curTs = r.agentDraftCreatedAt?.getTime() ?? 0;
    if (curTs > prevTs) seen.set(r.id, r);
  }
  // Pending rows surface to the top so the user can see what needs their
  // attention at a glance. Within each group (pending first, everything
  // else after) we keep the existing newest-first ordering so the list
  // doesn't feel reshuffled. Skipping the All/Pending/Done filter for α
  // per scoping — this sort + the row marker is enough signal.
  const items = Array.from(seen.values())
    .sort(compareInboxRows)
    .slice(0, 50);

  // Phase 8 — proactive proposals (ambiguity / capacity / etc.). Inbox
  // surfaces ONLY user-actionable rows; passive `auto_action_log` rows
  // (Steadii silently did X) move to the bell + digest per Fix 5
  // (2026-04-29 sparring). Wrapped in try/catch so that a missing
  // agent_proposals table degrades to "no proposals" instead of
  // crashing the email inbox.
  let proposals: Array<{
    id: string;
    issueType: typeof agentProposals.$inferSelect.issueType;
    issueSummary: string;
    status: typeof agentProposals.$inferSelect.status;
    viewedAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }> = [];
  try {
    proposals = await db
      .select({
        id: agentProposals.id,
        issueType: agentProposals.issueType,
        issueSummary: agentProposals.issueSummary,
        status: agentProposals.status,
        viewedAt: agentProposals.viewedAt,
        resolvedAt: agentProposals.resolvedAt,
        createdAt: agentProposals.createdAt,
      })
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          ne(agentProposals.issueType, "auto_action_log"),
          or(
            eq(agentProposals.status, "pending"),
            eq(agentProposals.status, "resolved"),
            eq(agentProposals.status, "dismissed")
          )
        )
      )
      .orderBy(desc(agentProposals.createdAt))
      .limit(20);
  } catch {
    proposals = [];
  }

  const sortedProposals = proposals.sort((a, b) => {
    const aPending = a.status === "pending" ? 0 : 1;
    const bPending = b.status === "pending" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[hsl(var(--foreground))]">{t("title")}</h1>
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            {t("subhead")}
          </p>
        </div>
      </header>

      <SteadiiNoticedToggle
        proposals={sortedProposals.map((p) => ({
          id: p.id,
          issueType: p.issueType,
          issueSummary: p.issueSummary,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        }))}
      />

      {!gmailConnected ? (
        <EmptyState
          icon={<InboxIcon size={18} />}
          title={t("empty_no_gmail_title")}
          description={t("empty_no_gmail_description")}
          actions={[{ label: t("empty_no_gmail_action"), href: "/app/settings" }]}
        />
      ) : items.length === 0 && sortedProposals.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={18} />}
          title={t("empty_clear_title")}
          description={t("empty_clear_description")}
        />
      ) : items.length === 0 ? null : (
        <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {items.map((item) => {
            const tier = tierFor(item.bucket, item.riskTier);
            const pending = isPendingDraft(
              item.agentDraftStatus,
              item.agentDraftAction
            );
            const needsClarification =
              pending && item.agentDraftAction === "ask_clarifying";
            const isImportantNoReply =
              pending && item.agentDraftAction === "notify_only";
            // polish-7 Gmail-style read state: a row is "attention"
            // worthy if the agent flagged it pending OR the user hasn't
            // opened it yet. Read non-pending rows fall to muted style
            // so the inbox feels resolved at a glance.
            const isUnread = !item.reviewedAt;
            const isAttention = pending || isUnread;
            return (
            <li key={item.id}>
              {/*
                Gmail-style "unread" treatment: NO background tint.
                Pending rows (= Steadii has draft_reply or ask_clarifying
                waiting on the user) get foreground sender/subject in
                semibold; non-pending rows get the muted text color so
                the read/unread distinction reads from typography alone.
                A small HelpCircle icon next to the subject calls out
                ask_clarifying — those need the user to provide info,
                not just hit Send.
              */}
              <Link
                href={item.agentDraftId ? `/app/inbox/${item.agentDraftId}` : "/app/inbox"}
                className="flex min-h-[44px] items-start gap-3 px-3 py-3 transition-hover hover:bg-[hsl(var(--surface-raised))] sm:px-4"
                data-pending={pending ? "true" : undefined}
                data-unread={isUnread ? "true" : undefined}
              >
                {pending ? <span className="sr-only">{t("pending_review_sr")}</span> : null}
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${tierTone(tier)}`}
                >
                  {tierLabel(tier, t)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      className={`min-w-0 truncate text-[14px] ${
                        isAttention
                          ? "font-semibold text-[hsl(var(--foreground))]"
                          : "font-normal text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      {item.senderName ?? item.senderEmail}
                    </span>
                    {item.firstTimeSender ? (
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        {t("new_sender_pill")}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      {shortTime(item.receivedAt)}
                    </span>
                  </div>
                  <div
                    className={`flex items-center gap-1.5 truncate text-[13px] ${
                      isAttention
                        ? "font-semibold text-[hsl(var(--foreground))]"
                        : "font-normal text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {needsClarification ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--primary))]"
                        title={t("question_pill_title")}
                      >
                        <HelpCircle size={10} strokeWidth={2} />
                        {t("question_pill")}
                      </span>
                    ) : null}
                    {isImportantNoReply ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--primary))]"
                        title={t("important_pill_title")}
                      >
                        <Star size={10} strokeWidth={2} fill="currentColor" />
                        {t("important_pill")}
                      </span>
                    ) : null}
                    <span className="truncate">
                      {item.subject ?? t("no_subject")}
                    </span>
                  </div>
                  {item.snippet ? (
                    <div className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                      {item.snippet}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
