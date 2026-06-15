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
// Send stub returns a sendAt 10s out so the preview's countdown toast
// renders without touching DB / QStash.
const NOOP_SEND = async () => ({
  sendAt: new Date(Date.now() + 10_000),
  undoWindowSeconds: 10,
});
// Dismiss stub that surfaces the ≥2-dismiss "ignore this sender?" offer
// so the verification harness can capture the toast. Synthetic sender
// only (matches the preview draft card's ignorableSender).
const NOOP_DISMISS_WITH_OFFER = async () => ({
  offerIgnoreSender: {
    senderEmail: "prof@u.sample-univ.example.edu",
    senderName: "Prof. Tanaka",
  },
});
const NOOP_IGNORE_SENDER = async (_senderEmail: string) => {};
const NOOP_SECONDARY = async (_id: string, _key: string) => {};
void NOOP_SECONDARY;
const NOOP_START_CLARIFICATION_CHAT = async () => ({ chatId: "preview-chat" });
const NOOP_EDIT_PROPOSAL = async (
  _cardId: string,
  _updates: {
    date?: string;
    startTime?: string;
    durationMin?: number;
    title?: string;
  },
) => {};
const NOOP_ARCHIVE_CONFIRM = async (_ids?: string[]) => {};

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
          weeklyDigestEnabled: true,
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
          undoWindowSeconds={10}
          actions={{
            resolveProposal: NOOP_RESOLVE,
            submitClarification: NOOP_E,
            startClarificationChat: NOOP_START_CLARIFICATION_CHAT,
            dismiss: NOOP_DISMISS_WITH_OFFER,
            snooze: NOOP_SNOOZE,
            permanentDismiss: NOOP,
            ignoreSender: NOOP_IGNORE_SENDER,
            secondaryAction: NOOP,
            sendDraft: NOOP_SEND,
            sendDraftAnyway: NOOP_SEND,
            cancelSendDraft: NOOP,
            sendOfficeHours: NOOP,
            setDisposition: NOOP,
            markHandled: NOOP,
            markNotNeeded: NOOP,
            confirm: NOOP,
            correct: NOOP,
            addToCalendar: NOOP,
            editProposal: NOOP_EDIT_PROPOSAL,
            dismissProposal: NOOP,
            archiveProposalConfirm: NOOP_ARCHIVE_CONFIRM,
            archiveProposalDismiss: NOOP,
          }}
        />
      )}
    </>
  );
}
