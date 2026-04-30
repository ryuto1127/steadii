import { loadTopHighRiskPending } from "@/lib/agent/email/pending-queries";
import { loadRecentAutoActions } from "@/lib/agent/proactive/auto-action-feed";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";
import { loadWaitlistAdminPending } from "@/lib/waitlist/admin-bell";
import { NotificationBellClient } from "./notification-bell-client";

// Server shell: runs the pending-drafts query AND the recent auto-action
// log query, plus admin-only waitlist-pending entries when the viewer is
// an admin. Hands all three to the client component for interactive
// open/close + mark-as-seen behavior.
//
// Two-section dropdown:
//   "Needs review"   = high-risk inbox pending + (admin) waitlist pending
//   "Steadii noticed" = passive auto-action records
const ADMIN_WAITLIST_LIMIT = 5;

export async function NotificationBell({ userId }: { userId: string }) {
  const isAdmin = await isUnlimitedPlan(userId);

  const [items, autoActions, adminWaitlist] = await Promise.all([
    loadTopHighRiskPending(userId, 5),
    loadRecentAutoActions(userId, { withinDays: 7, limit: 10 }),
    isAdmin
      ? loadWaitlistAdminPending(userId, ADMIN_WAITLIST_LIMIT)
      : Promise.resolve({ items: [], total: 0 }),
  ]);

  return (
    <NotificationBellClient
      items={items}
      autoActions={autoActions}
      adminWaitlist={adminWaitlist.items}
      adminWaitlistTotal={adminWaitlist.total}
    />
  );
}
