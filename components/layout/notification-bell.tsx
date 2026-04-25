import { loadTopHighRiskPending } from "@/lib/agent/email/pending-queries";
import { NotificationBellClient } from "./notification-bell-client";

// Server shell: runs the pending-drafts query, hands the rows to the
// client component for interactive open/close + mark-as-seen behavior.
export async function NotificationBell({ userId }: { userId: string }) {
  const items = await loadTopHighRiskPending(userId, 5);
  return <NotificationBellClient items={items} />;
}
