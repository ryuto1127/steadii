"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  QueueCardRenderer,
  type QueueCardActions,
} from "@/components/agent/queue-card";
import { queueShowMoreState } from "@/lib/agent/queue/visual";
import { QUEUE_VISIBLE_LIMIT, type QueueCard } from "@/lib/agent/queue/types";
import type { PreSendWarning } from "@/lib/db/schema";

// 2026-06-09 — the queue Draft "Send" no longer runs a client-side timer.
// Send fires the server action immediately, which enqueues the send via
// QStash with the per-user undo window. Because the wait lives on the
// server, the undo survives in-app navigation AND tab close — the old
// client timer cancelled every pending send on unmount, silently dropping
// a consented send while the toast read as success (ACTION_COMMITMENT_
// VIOLATION). The countdown toast below is purely cosmetic now: it shows
// remaining seconds but no longer GATES the send.

const PRE_SEND_CHECK_ERROR_NAME = "PreSendCheckFailedError";

// Server-action errors don't preserve `instanceof` across the boundary;
// the typed PreSendCheckFailedError arrives as a regular Error whose
// message is a JSON envelope keyed by `name`. Pluck the warnings out so
// the card-level warning panel (Review / Send anyway) can render them —
// same parse the inbox-detail DraftActions uses.
function tryParsePreSendError(err: unknown): PreSendWarning[] | null {
  if (!(err instanceof Error)) return null;
  if (err.name !== PRE_SEND_CHECK_ERROR_NAME) return null;
  try {
    const parsed = JSON.parse(err.message) as {
      name?: string;
      warnings?: unknown;
    };
    if (parsed?.name !== PRE_SEND_CHECK_ERROR_NAME) return null;
    if (!Array.isArray(parsed.warnings)) return null;
    return parsed.warnings
      .filter(
        (w): w is { phrase: unknown; why: unknown } =>
          !!w && typeof w === "object"
      )
      .map((w) => ({
        phrase: typeof w.phrase === "string" ? w.phrase : "",
        why: typeof w.why === "string" ? w.why : "",
      }))
      .filter((w) => w.phrase.length > 0 && w.why.length > 0);
  } catch {
    return null;
  }
}

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
  // dismiss now returns an optional contextual offer to ignore the
  // sender. Surfaces only for draft cards whose sender has been dismissed
  // ≥ the threshold; the client renders a sonner toast with an "無視する"
  // action calling ignoreSender when present.
  dismiss: (
    cardId: string
  ) => Promise<{
    offerIgnoreSender?: { senderEmail: string; senderName: string | null };
  }>;
  snooze: (cardId: string, hours: number) => Promise<void>;
  permanentDismiss: (cardId: string) => Promise<void>;
  // 今後この送信者を無視 — ignore a sender permanently (upsert + retroactive
  // clear). Wired on Type B/C/E cards carrying an ignorable sender, both
  // from the quick-menu item and the 2nd-dismiss offer toast.
  ignoreSender: (senderEmail: string) => Promise<void>;
  // Wave 3.1 — Type B informational secondary action handler. The only
  // inline secondary today is "mark_reviewed" on a meeting pre-brief;
  // anything else uses href navigation and never lands here.
  secondaryAction: (cardId: string, actionKey: string) => Promise<void>;
  // Wave 3.3 — sends an office_hours Type B draft (Gmail draft + send +
  // provisional calendar event). For non-office-hours B cards the page
  // routes the user to the existing detail page.
  sendOfficeHours: (cardId: string) => Promise<void>;
  // 2026-06-09 — Send a Type B Draft card. Enqueues the send server-side
  // (QStash + per-user undo window) via approveAgentDraftAction WITH the
  // pre-send fact-check, returning the authoritative sendAt the toast
  // counts down from. Throws PreSendCheckFailedError when the check
  // flags the draft — the client then surfaces the Review / Send-anyway
  // warning panel.
  sendDraft: (
    cardId: string
  ) => Promise<{ sendAt: Date; undoWindowSeconds: number }>;
  // Explicit "Send anyway" — user saw the flagged phrases and chose to
  // send. Skips the pre-send check (an explicit user choice, never the
  // silent default). Same server-side undo window.
  sendDraftAnyway: (
    cardId: string
  ) => Promise<{ sendAt: Date; undoWindowSeconds: number }>;
  // Undo a queued send within the window — drops the QStash message,
  // deletes the Gmail draft, flips the draft back to pending.
  cancelSendDraft: (cardId: string) => Promise<void>;
  // 2026-05-24 (PR 3) — sets disposition on a Type B Draft card.
  // 'resolved' / 'skipped' / 'ignored'; 'ignored' is gated behind a
  // confirm dialog on the UI side.
  setDisposition: (
    cardId: string,
    disposition: "resolved" | "skipped" | "ignored"
  ) => Promise<void>;
  // 確認済み — unified neutral "I already handled / saw this" across ALL
  // card kinds. Maps to the 'resolved' disposition family server-side and
  // never writes a negative learning signal (distinct from dismiss/却下).
  markHandled: (cardId: string) => Promise<void>;
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
  undoWindowSeconds,
}: {
  cards: QueueCard[];
  actions: ServerActions;
  // Per-user undo window (users.undo_window_seconds). The server enqueues
  // the send with this delay; the countdown toast mirrors it.
  undoWindowSeconds: number;
}) {
  const t = useTranslations("queue");
  const tShared = useTranslations("queue.shared");
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  // Heading anchor — on collapse ("閉じる") we smooth-scroll the user back
  // up to the queue heading so the list shrinking under them doesn't
  // strand the viewport mid-page. Held as a ref to the <h2 id="queue
  // -section">. SSR-guarded at call time (scrollIntoView is undefined on
  // the server / before hydration).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set of card ids whose send is in-flight or inside the server undo
  // window. Drives the card's dim state. Distinct from the old client
  // timer: the SEND already happened server-side by the time the card is
  // in this set, so unmounting can't drop it.
  const [sendingCardIds, setSendingCardIds] = useState<Set<string>>(() => new Set());
  // Per-card pre-send warnings. When the fact-checker flags a draft the
  // server action throws; we park the warnings here and render the
  // Review / Send-anyway panel above the card (mirrors the inbox-detail
  // modal semantics).
  const [preSendWarnings, setPreSendWarnings] = useState<
    Map<string, PreSendWarning[]>
  >(() => new Map());

  const addSendingCard = (cardId: string) =>
    setSendingCardIds((prev) => {
      if (prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });
  const removeSendingCard = (cardId: string) =>
    setSendingCardIds((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  const setWarningsForCard = (cardId: string, warnings: PreSendWarning[]) =>
    setPreSendWarnings((prev) => {
      const next = new Map(prev);
      next.set(cardId, warnings);
      return next;
    });
  const clearWarningsForCard = (cardId: string) =>
    setPreSendWarnings((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });

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

  // Bottom show-more / show-less control. The label + count + scroll
  // behavior come from the pure helper so the count math stays unit-
  // testable. The control renders only when there's overflow beyond the
  // visible cap.
  const showMore = queueShowMoreState({
    totalCount: cards.length,
    visibleLimit: QUEUE_VISIBLE_LIMIT,
    expanded,
  });

  const toggleExpanded = () => {
    const willCollapse = expanded;
    setExpanded((v) => !v);
    // On collapse, jump the viewport back up to the heading. Deferred a
    // tick so the list has shrunk before we scroll. Guarded for SSR /
    // no-rAF environments (tests, older runtimes); the optional-chained
    // ref + scrollIntoView existence check make it a no-op there.
    if (
      willCollapse &&
      showMore.scrollToHeadingOnClick &&
      typeof requestAnimationFrame === "function"
    ) {
      requestAnimationFrame(() => {
        const heading = headingRef.current;
        if (heading && typeof heading.scrollIntoView === "function") {
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  };

  // Fire the server-side send for a Draft card. The server enqueues via
  // QStash with the per-user undo window and returns the authoritative
  // sendAt. We dim the card, show a countdown toast whose Undo calls the
  // server cancel, and refresh once the window passes so the (now-sent)
  // card drops out. Because the wait lives server-side, navigating away
  // or closing the tab does NOT drop the send.
  //
  // `sendFn` is either the checked send or the explicit "Send anyway"
  // bypass. On a pre-send check failure the checked path throws
  // PreSendCheckFailedError; we park the warnings and render the panel
  // instead of sending.
  const runServerSend = (
    cardId: string,
    sendFn: (
      id: string
    ) => Promise<{ sendAt: Date; undoWindowSeconds: number }>
  ) => {
    clearWarningsForCard(cardId);
    addSendingCard(cardId);
    void sendFn(cardId)
      .then(({ sendAt, undoWindowSeconds: ws }) => {
        showSendUndoToast(cardId, sendAt, ws);
      })
      .catch((err) => {
        removeSendingCard(cardId);
        const warnings = tryParsePreSendError(err);
        if (warnings && warnings.length > 0) {
          // Don't send — surface the card-level Review / Send-anyway
          // warning. The send is NOT in flight (the server threw before
          // enqueuing), so the card is fully restored.
          setWarningsForCard(cardId, warnings);
          return;
        }
        toast.error(message(err, t("toast_send_failed")));
        refresh();
      });
  };

  // Cosmetic countdown toast for an already-enqueued send. The send is
  // committed server-side; this toast only shows the remaining window and
  // an Undo that calls the server cancel. When the window passes we
  // refresh so the sent card drops from the queue.
  const showSendUndoToast = (
    cardId: string,
    sendAt: Date,
    ws: number
  ) => {
    const toastId = `queue-send:${cardId}`;
    const sendAtMs = new Date(sendAt).getTime();
    const remainingSeconds = () =>
      Math.max(0, Math.ceil((sendAtMs - Date.now()) / 1000));

    const renderToast = () => {
      toast(t("toast_sending_countdown", { seconds: remainingSeconds() }), {
        id: toastId,
        duration: Math.max(1, ws) * 1000,
        action: {
          label: t("toast_undo"),
          onClick: () => {
            window.clearInterval(intervalHandle);
            void actions
              .cancelSendDraft(cardId)
              .then(() => {
                toast.success(t("toast_send_cancelled"));
              })
              .catch((err) => {
                toast.error(message(err, t("toast_send_failed")));
              })
              .finally(() => {
                removeSendingCard(cardId);
                toast.dismiss(toastId);
                refresh();
              });
          },
        },
      });
    };

    renderToast();
    const intervalHandle = window.setInterval(() => {
      if (remainingSeconds() <= 0) {
        window.clearInterval(intervalHandle);
        toast.dismiss(toastId);
        removeSendingCard(cardId);
        // The server already promoted the send when the window elapsed;
        // refresh drops the card via a fresh DB read.
        refresh();
        return;
      }
      renderToast();
    }, 1000);
  };

  // 今後この送信者を無視 — the ≥2-dismiss contextual nudge. Renders a
  // sonner toast naming the sender with an "無視する" action that calls
  // ignoreSender + refreshes. Auto-dismisses after the default window if
  // the user takes no action (don't pin a permanent prompt).
  const offerIgnoreSenderToast = (sender: {
    senderEmail: string;
    senderName: string | null;
  }) => {
    const label = sender.senderName ?? sender.senderEmail;
    toast(t("ignore_sender.offer_prompt", { sender: label }), {
      duration: 10000,
      action: {
        label: t("ignore_sender.offer_action"),
        onClick: () => {
          void actions
            .ignoreSender(sender.senderEmail)
            .then(() => {
              toast.success(
                t("ignore_sender.confirmed", { sender: label })
              );
              refresh();
            })
            .catch((err) => {
              toast.error(message(err, "Failed to ignore sender"));
            });
        },
      },
    });
  };

  return (
    <section
      aria-labelledby="queue-section"
      className="flex flex-col gap-2 sm:gap-3"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2
            ref={headingRef}
            id="queue-section"
            className="font-display text-[20px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]"
          >
            {t("section_heading")}
          </h2>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
            {t("section_caption")}
          </p>
        </div>
      </header>
      <ul className="flex flex-col gap-2.5 sm:gap-3">
        {visible.map((card) => {
          const isSendingPending = sendingCardIds.has(card.id);
          const cardActions: QueueCardActions = {
            isSendingPending,
            undoWindowSeconds,
            onDismiss: async () => {
              try {
                const res = await actions.dismiss(card.id);
                // 2nd-dismiss contextual nudge: when the server says this
                // sender has crossed the threshold, surface a toast with
                // an "無視する" action. Refresh first so the dismissed card
                // drops, then show the offer over the fresh list.
                refresh();
                if (res?.offerIgnoreSender) {
                  offerIgnoreSenderToast(res.offerIgnoreSender);
                }
                return;
              } catch (err) {
                toast.error(message(err, tShared("dismiss")));
              }
              refresh();
            },
            onIgnoreSender: card.ignorableSender
              ? async () => {
                  const sender = card.ignorableSender;
                  if (!sender) return;
                  try {
                    await actions.ignoreSender(sender.senderEmail);
                    toast.success(
                      t("ignore_sender.confirmed", {
                        sender: sender.senderName ?? sender.senderEmail,
                      })
                    );
                  } catch (err) {
                    toast.error(message(err, "Failed to ignore sender"));
                  }
                  refresh();
                }
              : undefined,
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
                    // calendar event). Other Type B drafts go through the
                    // shared server-side send: approveAgentDraftAction
                    // enqueues with the per-user undo window AND runs the
                    // pre-send fact-check.
                    if (card.id.startsWith("office_hours:")) {
                      try {
                        await actions.sendOfficeHours(card.id);
                        toast.success(t("toast_sent"));
                      } catch (err) {
                        toast.error(message(err, t("toast_send_failed")));
                      }
                      refresh();
                      return;
                    }
                    runServerSend(card.id, actions.sendDraft);
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
            // 確認済み — neutral "handled / saw it" on the non-draft
            // judgment + FYI cards (Type A decisions, Type C soft
            // notices). Draft cards already carry the 対応済み disposition
            // row, so we don't double-wire them here.
            onMarkHandled:
              card.archetype === "A" || card.archetype === "C"
                ? async () => {
                    try {
                      await actions.markHandled(card.id);
                    } catch (err) {
                      toast.error(message(err, "Action failed"));
                    }
                    refresh();
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
          const cardWarnings = preSendWarnings.get(card.id) ?? null;
          return (
            <li key={card.id} className="steadii-card-enter">
              {cardWarnings && cardWarnings.length > 0 ? (
                <PreSendWarningPanel
                  warnings={cardWarnings}
                  onReview={
                    card.detailHref
                      ? () => router.push(card.detailHref!)
                      : undefined
                  }
                  onSendAnyway={() =>
                    runServerSend(card.id, actions.sendDraftAnyway)
                  }
                  onCancel={() => clearWarningsForCard(card.id)}
                />
              ) : null}
              <QueueCardRenderer card={card} actions={cardActions} />
            </li>
          );
        })}
      </ul>
      {showMore.shouldShowToggle ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls="queue-section"
          className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-2.5 text-[13px] font-medium text-[hsl(var(--muted-foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary)/0.5)]"
        >
          <span>{t(showMore.labelKey, showMore.labelValues)}</span>
          {expanded ? (
            <ChevronUp size={14} strokeWidth={1.75} />
          ) : (
            <ChevronDown size={14} strokeWidth={1.75} />
          )}
        </button>
      ) : null}
    </section>
  );
}

function message(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// Card-level pre-send warning panel. Mirrors the inbox-detail
// PreSendWarningModal semantics (Review / Send anyway) but rendered inline
// above the card instead of as a fullscreen modal — the queue is a list,
// not a focused detail view. "Review" jumps to the inbox detail (where the
// user can edit the draft); "Send anyway" is an explicit user bypass of
// the fact-check; "Cancel" dismisses the panel and leaves the draft
// untouched.
function PreSendWarningPanel({
  warnings,
  onReview,
  onSendAnyway,
  onCancel,
}: {
  warnings: PreSendWarning[];
  onReview?: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("queue.pre_send_warning");
  return (
    <div
      role="alert"
      className="mb-1.5 rounded-xl border border-[hsl(38_92%_40%/0.35)] bg-[hsl(38_92%_50%/0.06)] p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-[hsl(38_92%_40%)]"
        />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
            {t("title")}
          </p>
          <p className="mt-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("body")}
          </p>
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {warnings.map((w, i) => (
          <li
            key={i}
            className="rounded-md border border-[hsl(38_92%_40%/0.3)] bg-[hsl(var(--surface))] px-2.5 py-1.5 text-[12px]"
          >
            <div className="font-medium text-[hsl(var(--foreground))]">
              &ldquo;{w.phrase}&rdquo;
            </div>
            <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              {w.why}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {onReview ? (
          <button
            type="button"
            onClick={onReview}
            className="inline-flex h-8 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("review")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSendAnyway}
          className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90"
        >
          {t("send_anyway")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-full px-2.5 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
