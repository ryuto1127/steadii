import { loadTopHighRiskPending } from "@/lib/agent/email/pending-queries";
import { loadRecentAutoActions } from "@/lib/agent/proactive/auto-action-feed";
import { NotificationBellClient } from "./notification-bell-client";

// Server shell: runs the pending-drafts query AND the recent auto-action
// log query, hands both to the client component for interactive open/close
// + mark-as-seen behavior. Two-section dropdown per Fix 5 (2026-04-29):
// "Needs review" = high-risk inbox pending; "Steadii noticed" = passive
// auto-action records that no longer surface in /app/inbox.
export async function NotificationBell({ userId }: { userId: string }) {
  const [items, autoActions] = await Promise.all([
    loadTopHighRiskPending(userId, 5),
    loadRecentAutoActions(userId, { withinDays: 7, limit: 10 }),
  ]);
  return <NotificationBellClient items={items} autoActions={autoActions} />;
}
