import { Inbox as InboxIcon } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { inboxItems, accounts } from "@/lib/db/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";

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

function bucketLabel(bucket: string): string {
  switch (bucket) {
    case "auto_high":
      return "High";
    case "auto_medium":
      return "Medium";
    case "auto_low":
      return "Low";
    case "l2_pending":
      return "Classifying";
    case "ignore":
      return "Ignore";
    default:
      return bucket;
  }
}

function bucketTone(bucket: string): string {
  switch (bucket) {
    case "auto_high":
      return "text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)]";
    case "auto_medium":
      return "text-[hsl(38_92%_40%)] bg-[hsl(38_92%_50%/0.12)]";
    case "auto_low":
      return "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]";
    case "l2_pending":
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

  const items = gmailConnected
    ? await db
        .select({
          id: inboxItems.id,
          senderEmail: inboxItems.senderEmail,
          senderName: inboxItems.senderName,
          subject: inboxItems.subject,
          snippet: inboxItems.snippet,
          receivedAt: inboxItems.receivedAt,
          bucket: inboxItems.bucket,
          firstTimeSender: inboxItems.firstTimeSender,
        })
        .from(inboxItems)
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
        .limit(50)
    : [];

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
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href="/app/inbox"
                className="flex items-start gap-3 px-4 py-3 transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${bucketTone(item.bucket)}`}
                >
                  {bucketLabel(item.bucket)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium text-[hsl(var(--foreground))]">
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
                  <div className="truncate text-[13px] text-[hsl(var(--foreground))]">
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
          ))}
        </ul>
      )}
    </div>
  );
}
