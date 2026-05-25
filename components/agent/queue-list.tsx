"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  QueueCardRenderer,
  type QueueCardActions,
} from "@/components/agent/queue-card";
import {
  SEND_UNDO_WINDOW_MS,
  startInlineSendTimer,
  type InlineSendTimer,
} from "@/lib/agent/queue/inline-send-timer";
import { QUEUE_VISIBLE_LIMIT, type QueueCard } from "@/lib/agent/queue/types";

// Client wrapper around the queue. Handles:
//   - the show-more / show-less toggle
//   - dispatching the server actions passed in as props
//   - light optimistic UI (the card itself flips into "resolved" mode
//     after the action returns; the surrounding list re-fetches via
//     `router.refresh()` so the resolved row drops out)
//
// All server-side dispatch is funnelled through the typed props below
// so this component is testable in isolation with stub actions.

type ServerActions = {
  resolveProposal: (
    cardId: string,
    actionKey: string
  ) => Promise<{ redirectTo?: string }>;
  submitClarification: (
    cardId: string,
    args: { pickedKey: string | null; freeText: string }
  ) => Promise<void>;
  // engineer-46 — opens a chat session seeded with the clarifying
  // card's context. Returns the new chat id so the client can push to
  // /app/chat/<id> after the server action resolves.
  startClarificationChat: (cardId: string) => Promise<{ chatId: string }>;
  dismiss: (cardId: string) => Promise<void>;
  snooze: (cardId: string, hours: number) => Promise<void>;
  permanentDismiss: (cardId: string) => Promise<void>;
  // Wave 3.1 — Type B informational secondary action handler. The only
  // inline secondary today is "mark_reviewed" on a meeting pre-brief;
  // anything else uses href navigation and never lands here.
  secondaryAction: (cardId: string, actionKey: string) => Promise<void>;
  // Wave 3.3 — sends an office_hours Type B draft (Gmail draft + send +
  // provisional calendar event). For non-office-hours B cards the page
  // routes the user to the existing detail page.
  sendOfficeHours: (cardId: string) => Promise<void>;
  // 2026-05-24 (PR 2) — fires after the client-side 10s undo window
  // elapses for a Type B Draft card. Wraps approveAgentDraftAction with
  // skipPreSendCheck=true; see queue-actions.ts:queueSendDraftAction.
  sendDraft: (cardId: string) => Promise<void>;
  // 2026-05-24 (PR 3) — sets disposition on a Type B Draft card.
  // 'resolved' / 'skipped' / 'ignored'; 'ignored' is gated behind a
  // confirm dialog on the UI side.
  setDisposition: (
    cardId: string,
    disposition: "resolved" | "skipped" | "ignored"
  ) => Promise<void>;
  // engineer-42 — Type F (interactive confirmations).
  confirm: (cardId: string) => Promise<void>;
  correct: (cardId: string, correctedValue: string) => Promise<void>;
  // 2026-05-24 (PR B / Round 3) — Type G' propose-confirm.
  //   addToCalendar     → fires calendarCreateEvent + flips
  //                       autoCreatedCalendarEvents.status='confirmed'.
  //   editProposal      → mutates agreedSlot in DB only (no calendar
  //                       API). The card pairs this with addToCalendar
  //                       under the [更新して追加] CTA so a single
  //                       click commits both.
  //   dismissProposal   → flips status='cancelled' (no calendar API
  //                       call since no event was ever created).
  addToCalendar: (cardId: string) => Promise<void>;
  editProposal: (
    cardId: string,
    updates: {
      date?: string;
      startTime?: string;
      durationMin?: number;
      title?: string;
    },
  ) => Promise<void>;
  dismissProposal: (cardId: string) => Promise<void>;
  // 2026-05-24 — Round 4. Type H (auto-archive batch propose-confirm).
  //   archiveProposalConfirm  → flips selected inbox_items.status to
  //                             'archived' + auto_archived true. When
  //                             inboxItemIds is undefined, every
  //                             currently-proposed item on the user
  //                             is archived.
  //   archiveProposalDismiss  → clears every proposed_archive_at flag
  //                             without archiving — items stay in inbox.
  archiveProposalConfirm: (inboxItemIds?: string[]) => Promise<void>;
  archiveProposalDismiss: () => Promise<void>;
};

export function QueueList({
  cards,
  actions,
}: {
  cards: QueueCard[];
  actions: ServerActions;
}) {
  const t = useTranslations("queue");
  const tShared = useTranslations("queue.shared");
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  // PR 2 — per-card pending send timers. The map is keyed by card id so
  // the user can fire 送信 across multiple Draft cards in parallel and
  // each card's 10s window is independent. Held in a ref because the
  // timer machine is identity-stable and we never want a render to
  // re-create one.
  const inlineSendTimers = useRef<Map<string, InlineSendTimer>>(new Map());
  // Per-card countdown intervals that drive the toast text update each
  // second. Keyed by card id so the user can fire 送信 across multiple
  // Draft cards in parallel without one card's countdown clobbering
  // another's. Cleared on undo, on elapse, and on unmount.
  const inlineSendIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map()
  );
  // PR 2 — set of card ids currently mid-undo-window. Lifted into state
  // so the card can dim itself when sending is pending and un-dim on
  // undo without waiting for router.refresh (which only fires after the
  // 10s timer elapses and the server actually accepts the send).
  const [sendingCardIds, setSendingCardIds] = useState<Set<string>>(() => new Set());

  // On unmount (route navigation, hot reload), cancel every pending send
  // timer. Without this a stale timer would fire against the unmounted
  // tree and attempt a router.refresh on a route that no longer exists.
  useEffect(() => {
    const timers = inlineSendTimers.current;
    const intervals = inlineSendIntervals.current;
    return () => {
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
      for (const handle of intervals.values()) clearInterval(handle);
      intervals.clear();
    };
  }, []);

  const visible = useMemo(() => {
    if (expanded) return cards;
    return cards.slice(0, QUEUE_VISIBLE_LIMIT);
  }, [cards, expanded]);

  if (cards.length === 0) {
    // Empty state is rendered by the page-level component, NOT here —
    // separating concerns lets the page CTA focus the command palette.
    return null;
  }

  const refresh = () => router.refresh();

  // PR 2 — kicks the client-side 10s timer for a Draft card's Send
  // click. Returns a Promise that resolves immediately so the card's
  // useTransition flow lands in the dimmed/resolved state right away;
  // the actual server send fires (or doesn't) when the timer elapses.
  const beginInlineSend = (cardId: string) => {
    // If a second click lands while the first timer is still pending,
    // treat it as "yes, definitely send" — cancel the still-pending
    // timer (idempotent) and start fresh. This matches the visible
    // behavior of clicking Send again: the toast resets to 10s.
    const existing = inlineSendTimers.current.get(cardId);
    if (existing) existing.cancel();

    const toastId = `queue-send:${cardId}`;
    setSendingCardIds((prev) => {
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });

    const clearCountdown = () => {
      const handle = inlineSendIntervals.current.get(cardId);
      if (handle !== undefined) {
        clearInterval(handle);
        inlineSendIntervals.current.delete(cardId);
      }
    };

    const cancelTimer = () => {
      const timer = inlineSendTimers.current.get(cardId);
      const cancelled = timer ? timer.cancel() : false;
      inlineSendTimers.current.delete(cardId);
      clearCountdown();
      setSendingCardIds((prev) => {
        if (!prev.has(cardId)) return prev;
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
      toast.dismiss(toastId);
      return cancelled;
    };

    const timer = startInlineSendTimer({
      cardId,
      onElapse: () => {
        // Timer fired without an undo — kick the actual server send.
        // Keep the card dim (isSendingPending stays true) for the
        // duration of the API call so the user sees a continuous
        // "sending" state through to refresh. On success the
        // approveAgentDraftAction flips agent_drafts.status to
        // sent_pending, so the next router.refresh drops the card from
        // the queue and our flag never matters again. On failure we
        // clear the flag and restore the card.
        inlineSendTimers.current.delete(cardId);
        clearCountdown();
        toast.dismiss(toastId);
        void actions
          .sendDraft(cardId)
          .then(() => {
            // Refresh first; the card disappears via fresh DB read.
            // Clearing the sending-id set after refresh keeps the dim
            // state coherent during the brief render gap.
            refresh();
            setSendingCardIds((prev) => {
              if (!prev.has(cardId)) return prev;
              const next = new Set(prev);
              next.delete(cardId);
              return next;
            });
          })
          .catch((err) => {
            setSendingCardIds((prev) => {
              if (!prev.has(cardId)) return prev;
              const next = new Set(prev);
              next.delete(cardId);
              return next;
            });
            toast.error(message(err, "Send failed"));
            refresh();
          });
      },
    });
    inlineSendTimers.current.set(cardId, timer);

    // Live countdown: re-render the toast each second with the remaining
    // whole seconds. Sonner re-uses an existing toast when the same id
    // is passed, so the update lands in place without a flicker. The
    // toast's own `duration` still drives the auto-dismiss at 10s in
    // case the interval misses a beat (tab throttled, etc.).
    let remainingSeconds = Math.ceil(SEND_UNDO_WINDOW_MS / 1000);
    const renderToast = () => {
      toast(t("toast_sending_countdown", { seconds: remainingSeconds }), {
        id: toastId,
        duration: SEND_UNDO_WINDOW_MS,
        action: {
          label: t("toast_undo"),
          onClick: () => {
            cancelTimer();
            toast.success(t("toast_send_cancelled"));
          },
        },
      });
    };
    renderToast();
    const intervalHandle = setInterval(() => {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        clearCountdown();
        return;
      }
      renderToast();
    }, 1000);
    inlineSendIntervals.current.set(cardId, intervalHandle);
  };

  return (
    <section
      aria-labelledby="queue-section"
      className="flex flex-col gap-2 sm:gap-3"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2
            id="queue-section"
            className="font-display text-[20px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]"
          >
            {t("section_heading")}
          </h2>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
            {t("section_caption")}
          </p>
        </div>
        {cards.length > QUEUE_VISIBLE_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {expanded ? (
              <>
                <span>{t("show_less")}</span>
                <ChevronUp size={12} strokeWidth={1.75} />
              </>
            ) : (
              <>
                <span>{t("show_more")}</span>
                <ChevronDown size={12} strokeWidth={1.75} />
              </>
            )}
          </button>
        ) : null}
      </header>
      <ul className="flex flex-col gap-2.5 sm:gap-3">
        {visible.map((card) => {
          const isSendingPending = sendingCardIds.has(card.id);
          const cardActions: QueueCardActions = {
            isSendingPending,
            onDismiss: async () => {
              try {
                await actions.dismiss(card.id);
              } catch (err) {
                toast.error(message(err, tShared("dismiss")));
              }
              refresh();
            },
            onSnooze: async (hours) => {
              try {
                await actions.snooze(card.id, hours);
              } catch (err) {
                toast.error(message(err, "Snooze failed"));
              }
              refresh();
            },
            onPermanentDismiss: async () => {
              try {
                await actions.permanentDismiss(card.id);
              } catch (err) {
                toast.error(message(err, "Dismiss failed"));
              }
              refresh();
            },
            onPickOption:
              card.archetype === "A"
                ? async (key) => {
                    try {
                      const res = await actions.resolveProposal(card.id, key);
                      if (res.redirectTo) {
                        router.push(res.redirectTo);
                        return;
                      }
                    } catch (err) {
                      toast.error(message(err, "Action failed"));
                    }
                    refresh();
                  }
                : undefined,
            onReview:
              card.archetype === "B"
                ? () => {
                    if (card.detailHref) router.push(card.detailHref);
                  }
                : undefined,
            onSend:
              card.archetype === "B"
                ? async () => {
                    // Office hours Type B drafts run their own send
                    // pipeline (Gmail draft + send + provisional
                    // calendar event). Other Type B drafts run the
                    // PR 2 inline send: a 10s client-side undo
                    // window via sonner toast, then the actual
                    // server send fires.
                    if (card.id.startsWith("office_hours:")) {
                      try {
                        await actions.sendOfficeHours(card.id);
                        toast.success(t("toast_sent"));
                      } catch (err) {
                        toast.error(message(err, "Send failed"));
                      }
                      refresh();
                      return;
                    }
                    beginInlineSend(card.id);
                  }
                : undefined,
            onSecondaryAction:
              card.archetype === "B"
                ? async (actionKey) => {
                    try {
                      await actions.secondaryAction(card.id, actionKey);
                    } catch (err) {
                      toast.error(message(err, "Action failed"));
                    }
                    refresh();
                  }
                : undefined,
            onSetDisposition:
              card.archetype === "B" && card.mode === "draft"
                ? async (disposition) => {
                    try {
                      await actions.setDisposition(card.id, disposition);
                    } catch (err) {
                      toast.error(message(err, "Action failed"));
                      refresh();
                      throw err;
                    }
                    refresh();
                  }
                : undefined,
            onTakeAction:
              card.archetype === "C"
                ? async () => {
                    if (card.detailHref) router.push(card.detailHref);
                  }
                : undefined,
            onSubmit:
              card.archetype === "E"
                ? async (pickedKey, freeText) => {
                    try {
                      await actions.submitClarification(card.id, {
                        pickedKey,
                        freeText,
                      });
                      // 2026-05-12 — confirm the response was captured.
                      // Without this toast the card just fades out
                      // silently and the user thinks the click was lost.
                      toast.success(t("card_e.submit_toast"));
                    } catch (err) {
                      toast.error(message(err, "Submit failed"));
                    }
                    refresh();
                  }
                : undefined,
            onTalkInChat:
              card.archetype === "E"
                ? async () => {
                    try {
                      const { chatId } = await actions.startClarificationChat(
                        card.id
                      );
                      router.push(`/app/chat/${chatId}`);
                    } catch (err) {
                      toast.error(message(err, "Open chat failed"));
                    }
                  }
                : undefined,
            onConfirm:
              card.archetype === "F"
                ? async () => {
                    try {
                      await actions.confirm(card.id);
                    } catch (err) {
                      toast.error(message(err, "Confirm failed"));
                    }
                    refresh();
                  }
                : undefined,
            onCorrect:
              card.archetype === "F"
                ? async (correctedValue) => {
                    try {
                      await actions.correct(card.id, correctedValue);
                    } catch (err) {
                      toast.error(message(err, "Save failed"));
                    }
                    refresh();
                  }
                : undefined,
            onAddToCalendar:
              card.archetype === "G"
                ? async () => {
                    try {
                      await actions.addToCalendar(card.id);
                      toast.success(t("card_g.add_toast"));
                    } catch (err) {
                      toast.error(message(err, "Add failed"));
                    }
                    refresh();
                  }
                : undefined,
            onEditProposal:
              card.archetype === "G"
                ? async (updates) => {
                    try {
                      await actions.editProposal(card.id, updates);
                    } catch (err) {
                      toast.error(message(err, "Update failed"));
                      // Rethrow so the card's chained add doesn't run on
                      // a stale slot — the [更新して追加] flow needs the
                      // edit to land before the add fires.
                      refresh();
                      throw err;
                    }
                  }
                : undefined,
            onDismissProposal:
              card.archetype === "G"
                ? async () => {
                    try {
                      await actions.dismissProposal(card.id);
                      toast.success(t("card_g.dismiss_toast"));
                    } catch (err) {
                      toast.error(message(err, "Dismiss failed"));
                    }
                    refresh();
                  }
                : undefined,
            onArchiveAll:
              card.archetype === "H"
                ? async () => {
                    try {
                      await actions.archiveProposalConfirm();
                      toast.success(
                        t("card_h.archive_toast", { n: card.totalCount }),
                      );
                    } catch (err) {
                      toast.error(message(err, "Archive failed"));
                    }
                    refresh();
                  }
                : undefined,
            onArchiveSelected:
              card.archetype === "H"
                ? async (ids) => {
                    try {
                      await actions.archiveProposalConfirm(ids);
                      toast.success(
                        t("card_h.archive_toast", { n: ids.length }),
                      );
                    } catch (err) {
                      toast.error(message(err, "Archive failed"));
                    }
                    refresh();
                  }
                : undefined,
            onCancelAll:
              card.archetype === "H"
                ? async () => {
                    try {
                      await actions.archiveProposalDismiss();
                      toast.success(t("card_h.cancel_toast"));
                    } catch (err) {
                      toast.error(message(err, "Cancel failed"));
                    }
                    refresh();
                  }
                : undefined,
          };
          return (
            <li key={card.id} className="steadii-card-enter">
              <QueueCardRenderer card={card} actions={cardActions} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function message(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
