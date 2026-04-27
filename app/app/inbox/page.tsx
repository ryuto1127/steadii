import { Inbox as InboxIcon } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { inboxItems, accounts, agentDrafts } from "@/lib/db/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import {
  compareInboxRows,
  isPendingDraft,
} from "@/lib/agent/email/pending-queries";

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

function tierLabel(tier: ReturnType<typeof tierFor>): string {
  switch (tier) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "classifying":
      return "Classifying";
    case "ignore":
      return "Ignore";
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

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[hsl(var(--foreground))]">Inbox</h1>
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            What the agent is looking at right now.
          </p>
        </div>
      </header>

      {!gmailConnected ? (
        <EmptyState
          icon={<InboxIcon size={18} />}
          title="Connect Gmail to start triage."
          description="Sign in again with Google to grant the Gmail scope. The agent triages, you confirm."
          actions={[{ label: "Reconnect in Settings", href: "/app/settings" }]}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={18} />}
          title="You're clear."
          description="Nothing pending. The agent will surface new items as they arrive."
        />
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {items.map((item) => {
            const tier = tierFor(item.bucket, item.riskTier);
            const pending = isPendingDraft(
              item.agentDraftStatus,
              item.agentDraftAction
            );
            return (
            <li key={item.id}>
              {/*
                Pending visual = subtle amber background tint + bolder
                sender/subject typography, mirroring email-client unread
                conventions (Gmail / Apple Mail). The previous 3px
                left-edge bar was a continuous line under consecutive
                pending rows — Ryuto observed it read as a single stripe
                rather than a per-row marker. Bold + tint keeps the
                per-row signal at a glance without the line artifact.
              */}
              <Link
                href={item.agentDraftId ? `/app/inbox/${item.agentDraftId}` : "/app/inbox"}
                className={`flex items-start gap-3 px-4 py-3 transition-hover hover:bg-[hsl(var(--surface-raised))] ${
                  pending ? "bg-[hsl(var(--primary)/0.04)]" : ""
                }`}
                data-pending={pending ? "true" : undefined}
              >
                {pending ? <span className="sr-only">Pending review.</span> : null}
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${tierTone(tier)}`}
                >
                  {tierLabel(tier)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`truncate text-[14px] text-[hsl(var(--foreground))] ${
                        pending ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {item.senderName ?? item.senderEmail}
                    </span>
                    {item.firstTimeSender ? (
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        New sender
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      {shortTime(item.receivedAt)}
                    </span>
                  </div>
                  <div
                    className={`truncate text-[13px] text-[hsl(var(--foreground))] ${
                      pending ? "font-semibold" : ""
                    }`}
                  >
                    {item.subject ?? "(no subject)"}
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
