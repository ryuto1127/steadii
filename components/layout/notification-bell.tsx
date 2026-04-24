import Link from "next/link";
import { Bell } from "lucide-react";
import { loadTopHighRiskPending } from "@/lib/agent/email/pending-queries";

// Server component — renders a <details> popover so no client-state glue.
// On hover/click, shows top 5 high-risk pending drafts. Each row links
// into the draft review page. No polling — relies on Next.js refresh on
// navigation, which is fine for α.
export async function NotificationBell({ userId }: { userId: string }) {
  const items = await loadTopHighRiskPending(userId, 5);
  const hasItems = items.length > 0;

  return (
    <details className="relative group/bell">
      <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md transition-hover hover:bg-[hsl(var(--surface-raised))] [&::-webkit-details-marker]:hidden">
        <Bell
          size={16}
          strokeWidth={1.75}
          className="text-[hsl(var(--muted-foreground))]"
        />
        {hasItems ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--destructive))]"
          />
        ) : null}
      </summary>
      <div className="absolute right-0 top-full z-20 mt-1 w-[340px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1 shadow-lg">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Needs attention
        </div>
        {!hasItems ? (
          <div className="px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
            No high-risk items right now.
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.agentDraftId}>
                <Link
                  href={`/app/inbox/${item.agentDraftId}`}
                  className="flex flex-col gap-0.5 rounded-md px-3 py-2 transition-hover hover:bg-[hsl(var(--surface-raised))]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${
                        item.riskTier === "high"
                          ? "text-[hsl(var(--destructive))]"
                          : item.riskTier === "medium"
                          ? "text-[hsl(38_92%_40%)]"
                          : "text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      {item.riskTier}
                    </span>
                    <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                      {item.senderName}
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                    {item.subject}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 border-t border-[hsl(var(--border))] px-3 py-2">
          <Link
            href="/app/inbox"
            className="text-[12px] text-[hsl(var(--primary))] hover:underline"
          >
            View all →
          </Link>
        </div>
      </div>
    </details>
  );
}
