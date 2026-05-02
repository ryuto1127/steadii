"use client";

import { CommandPalette } from "@/components/chat/command-palette";
import { QueueList } from "@/components/agent/queue-list";
import { QueueEmptyState } from "@/components/agent/queue-empty-state";
import { NotificationSettings } from "@/components/settings/notifications";
import { DEFAULT_NOTIFICATION_TIER_PREFS } from "@/lib/notifications/tier-matrix";
import type { QueueCard } from "@/lib/agent/queue/types";

const NOOP = async () => {};
const NOOP_RESOLVE = async () => ({});
const NOOP_E = async () => {};
const NOOP_SNOOZE = async () => {};

// Client-side mount for the verification harness. Reuses the real
// QueueList wrapper so the i18n-aware section heading + show-more
// toggle behave the same as production. All server actions are stubbed
// out — the harness never touches DB.
export function QueuePreviewClient({
  cards,
  showEmpty,
  variant = "default",
}: {
  cards: QueueCard[];
  showEmpty: boolean;
  variant?: "default" | "notifications";
}) {
  if (variant === "notifications") {
    return (
      <NotificationSettings
        initial={{
          digestEnabled: true,
          digestHourLocal: 7,
          undoWindowSeconds: 10,
          highRiskNotifyImmediate: true,
          notificationTiers: DEFAULT_NOTIFICATION_TIER_PREFS,
        }}
      />
    );
  }
  return (
    <>
      <div data-command-palette className="mb-8">
        <CommandPalette />
      </div>

      {showEmpty ? (
        <QueueEmptyState />
      ) : (
        <QueueList
          cards={cards}
          actions={{
            resolveProposal: NOOP_RESOLVE,
            submitClarification: NOOP_E,
            dismiss: NOOP,
            snooze: NOOP_SNOOZE,
            permanentDismiss: NOOP,
          }}
        />
      )}
    </>
  );
}
