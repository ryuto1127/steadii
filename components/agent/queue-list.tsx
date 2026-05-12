"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  QueueCardRenderer,
  type QueueCardActions,
} from "@/components/agent/queue-card";
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
  // engineer-42 — Type F (interactive confirmations).
  confirm: (cardId: string) => Promise<void>;
  correct: (cardId: string, correctedValue: string) => Promise<void>;
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
          const cardActions: QueueCardActions = {
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
                    // calendar event). Other Type B drafts route to
                    // the existing inbox detail page where the W1
                    // send + 10s undo machinery is wired.
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
                    if (card.detailHref) router.push(card.detailHref);
                  }
                : undefined,
            onSkip:
              card.archetype === "B"
                ? async () => {
                    try {
                      await actions.dismiss(card.id);
                    } catch (err) {
                      toast.error(message(err, "Skip failed"));
                    }
                    refresh();
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
