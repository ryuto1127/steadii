"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertTriangle,
  Archive,
  BellOff,
  BookOpen,
  Calendar as CalendarIcon,
  Check,
  ChevronRight,
  Clock,
  HelpCircle,
  Mail,
  MessageCircleQuestion,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import type {
  QueueCard,
  QueueCardA,
  QueueCardB,
  QueueCardC,
  QueueCardD,
  QueueCardE,
  QueueCardF,
  QueueCardG,
  QueueCardH,
  QueueSourceChip,
} from "@/lib/agent/queue/types";
import {
  cardGBuildEditPatch,
  cardGDaysUntilExpiry,
  cardGProposalHeaderKey,
  cardGShouldShowExpiry,
  cardGShouldShowTimePickers,
  cardGValidateEdit,
  cardHDaysUntilExpiry,
  cardHShouldShowExpiry,
  confidenceBorderClass,
  isExternalOriginHref,
} from "@/lib/agent/queue/visual";

// Wave 2 queue card — the unified primitive for the 5 archetypes
// (A/B/C/D/E) on the new Home page. Built as a single client component
// so right-click menus, optimistic action dispatch, and snooze interactions
// all live in one place.
//
// Design lock: see `project_wave_2_home_design.md` (memory). Anything
// here that contradicts the spec is a bug.
//
// Action wiring: each archetype takes per-archetype callbacks. The
// callbacks are async and may return an `undoToken` string; if they do,
// the card pops a 10s Undo banner. The actual server-side dispatch lives
// in the page-level `app/app/page.tsx` server component, which passes
// down server actions wrapped in client closures.

type ActionResult = { undoToken?: string } | void;

type CommonProps = {
  card: QueueCard;
  // Per-user undo window (users.undo_window_seconds) for the Undo banner
  // countdown. Optional with a 10s fallback so call sites that don't have
  // the user value (dev preview, tests) still render. Replaces the old
  // hardcoded 10 so a user who changed the window sees the right count.
  undoWindowSeconds?: number;
  // Default Dismiss = 24h snooze per spec. Long-press / quick menu offers
  // permanent dismiss separately.
  onDismiss: () => Promise<ActionResult> | ActionResult;
  // Snooze 1h / 24h / 1 week — exposed via the right-click / long-press
  // quick menu. The selection is the snooze duration in hours.
  onSnooze: (hours: number) => Promise<ActionResult> | ActionResult;
  // Permanent dismiss — never re-fires for this trigger. Records as
  // negative feedback signal in the engine.
  onPermanentDismiss: () => Promise<ActionResult> | ActionResult;
  // Optional Undo handler. When the parent passes one, the 10s Undo
  // banner becomes interactive. Otherwise the card surfaces only a
  // toast-style passive label and silently completes.
  onUndo?: (token: string) => Promise<void> | void;
  // 確認済み — NEUTRAL "I already handled / saw this". Distinct from
  // onDismiss (the suppress/negative signal): mark-handled never demotes
  // a sender or biases the proactive scanner; it just clears the card.
  // Optional because draft-mode cards expose the same intent via their
  // own 対応済み disposition button; non-draft judgment/FYI cards wire
  // this instead.
  onMarkHandled?: () => Promise<ActionResult> | ActionResult;
  // 今後この送信者を無視 — permanently ignore the card's sender. Wired only
  // on cards carrying `card.ignorableSender` (draft / soft-notice /
  // clarify). When present, the quick menu renders an "Ignore this sender"
  // item. Distinct from onPermanentDismiss (which suppresses just THIS
  // trigger) — ignore-sender stops ALL future mail from the sender.
  onIgnoreSender?: () => Promise<ActionResult> | ActionResult;
};

type CardAProps = CommonProps & {
  card: QueueCardA;
  onPickOption: (optionKey: string) => Promise<ActionResult> | ActionResult;
};

type CardBProps = CommonProps & {
  card: QueueCardB;
  onReview: () => void;
  onSend: () => Promise<ActionResult> | ActionResult;
  // Wave 3.1 — informational variant only. Fires when the user clicks
  // the [Mark reviewed] secondary action (or any other inline-action
  // secondary). The parent records the review and removes the card.
  onSecondaryAction?: (key: string) => Promise<ActionResult> | ActionResult;
  // PR 2 — controlled "send is mid-undo-window" flag. When the parent
  // is running the 10s client timer for this card, it sets this to true
  // so the card dims/disables in lockstep with the toast countdown. On
  // undo the parent flips it back to false and the card un-dims
  // without needing a router.refresh — local resolved state would have
  // gotten stuck otherwise.
  isSendingPending?: boolean;
  // PR 3 — 3-way disposition setter. Renders the 対応済み / スキップ /
  // 無視中 row below the primary action row on Draft-mode cards.
  // 無視中 is gated behind a window.confirm dialog (no extra primitive
  // — the rest of the queue UI uses native confirms for destructive
  // bulk paths, e.g. account-delete).
  onSetDisposition?: (
    disposition: "resolved" | "skipped" | "ignored"
  ) => Promise<ActionResult> | ActionResult;
};

type CardCProps = CommonProps & {
  card: QueueCardC;
  onTakeAction: () => Promise<ActionResult> | ActionResult;
};

type CardDProps = CommonProps & {
  card: QueueCardD;
};

type CardEProps = CommonProps & {
  card: QueueCardE;
  onSubmit: (
    pickedKey: string | null,
    freeText: string
  ) => Promise<ActionResult> | ActionResult;
  // engineer-46 — "Steadii と話す" / "Talk to Steadii" affordance. When
  // provided, the Type E card renders a second primary action that
  // opens a chat session seeded with the email + the clarifying
  // question instead of forcing the single-shot textarea path.
  // Optional so call sites that don't yet wire it stay valid.
  onTalkInChat?: () => Promise<void> | void;
};

// engineer-42 — Type F (interactive confirmations). Three actions:
//   confirm   → the inferred value is correct; persona structured fact
//               pinned at confidence 1.0
//   correct   → user supplies a different value (free-text inline input);
//               persona structured fact pinned to the corrected value
//   dismiss   → user says "don't ask"; status flips to dismissed, persona
//               is NOT written (engineer-43 may treat this as a signal to
//               suppress future questions on the same topic)
type CardFProps = CommonProps & {
  card: QueueCardF;
  onConfirm: () => Promise<ActionResult> | ActionResult;
  onCorrect: (correctedValue: string) => Promise<ActionResult> | ActionResult;
};

// 2026-05-24 — Type G' (auto-cal propose-confirm). Three actions:
//   onAddToCalendar  → user clicks カレンダーに追加 on a `proposed` row.
//                      The server action fires calendarCreateEvent NOW
//                      with the agreed slot and flips status to
//                      'confirmed'. The calendar is only touched here.
//   onEditProposal   → user opens the inline editor, mutates date /
//                      startTime / durationMin / title, and saves. The
//                      server action merges into agreedSlot only — NO
//                      calendar API call. The user still has to click
//                      Add to actually commit. The editor wires this
//                      followed by onAddToCalendar on `[更新して追加]`.
//   onDismissProposal→ user clicks 破棄. Status flips to 'cancelled'
//                      with no calendar API call (event_refs is empty
//                      for proposals). No confirm modal per spec —
//                      recoverable in the sense that the row stays in
//                      DB as 'cancelled' and the user can manually
//                      re-add from the original email.
type CardGEditPatch = {
  date?: string;
  startTime?: string;
  durationMin?: number;
  title?: string;
};
type CardGProps = CommonProps & {
  card: QueueCardG;
  onAddToCalendar: () => Promise<ActionResult> | ActionResult;
  onEditProposal: (
    updates: CardGEditPatch,
  ) => Promise<ActionResult> | ActionResult;
  onDismissProposal: () => Promise<ActionResult> | ActionResult;
};

// 2026-05-24 — Type H (auto-archive batch propose-confirm). Three
// actions:
//   onArchiveAll       → user clicked [全部アーカイブする]. Server
//                        flips every currently-proposed item's status
//                        to archived + auto_archived true.
//   onArchiveSelected  → user opened per-item review, picked a
//                        subset, then submitted [選択した N 件を
//                        アーカイブ]. Server archives only those ids.
//   onCancelAll        → user clicked [全部キャンセル]. Server clears
//                        every proposed_archive_at flag — nothing
//                        archived, items stay in inbox.
type CardHProps = CommonProps & {
  card: QueueCardH;
  onArchiveAll: () => Promise<ActionResult> | ActionResult;
  onArchiveSelected: (
    inboxItemIds: string[],
  ) => Promise<ActionResult> | ActionResult;
  onCancelAll: () => Promise<ActionResult> | ActionResult;
};

// Source chip — one per origin record the agent referenced. Visual
// vocabulary is the same as `components/agent/thinking-bar.tsx` pills so
// users see consistent labels across the queue and the inbox detail
// pages.
function SourceChip({ source }: { source: QueueSourceChip }) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]";
  const tone = (() => {
    switch (source.kind) {
      case "email":
        return "border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]";
      case "mistake":
        return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
      case "syllabus":
        return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
      case "calendar":
        return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    }
  })();
  const Icon = (() => {
    switch (source.kind) {
      case "email":
        return Mail;
      case "mistake":
        return AlertTriangle;
      case "syllabus":
        return BookOpen;
      case "calendar":
        return CalendarIcon;
    }
  })();
  const inner = (
    <>
      <Icon size={11} strokeWidth={1.75} />
      <span className="font-mono text-[10px] tabular-nums">
        {source.kind}-{source.index}
      </span>
      <span className="max-w-[180px] truncate">{source.label}</span>
    </>
  );
  if (source.href) {
    return (
      <a href={source.href} className={`${base} ${tone}`} title={source.label}>
        {inner}
      </a>
    );
  }
  return (
    <span className={`${base} ${tone}`} title={source.label}>
      {inner}
    </span>
  );
}

// Relative timestamp display. We compute on render rather than caching so
// the value stays current across re-renders without ticking. The full
// absolute timestamp lives in the `title` attribute as a tooltip.
function formatRelative(iso: string, locale: "en" | "ja"): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return locale === "ja" ? "たった今" : "just now";
  if (mins < 60)
    return locale === "ja" ? `${mins} 分前` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)
    return locale === "ja" ? `${hrs} 時間前` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return locale === "ja" ? `${days} 日前` : `${days}d ago`;
  const d = new Date(iso);
  return locale === "ja"
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Quick menu (right-click / long-press) ────────────────────────────
function QuickMenu({
  visible,
  x,
  y,
  onClose,
  onSnooze,
  onDismissPerm,
  onIgnoreSender,
}: {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onSnooze: (hours: number) => void;
  onDismissPerm: () => void;
  // 今後この送信者を無視 — only rendered when the card carries an
  // ignorable sender; undefined hides the menu item entirely.
  onIgnoreSender?: () => void;
}) {
  const t = useTranslations("queue.menu");
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = () => onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [visible, onClose]);
  if (!visible) return null;
  // Stop bubbling so the document-level click listener doesn't immediately
  // close the menu the same tick it opens.
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-[200px] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] py-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
      style={{ left: x, top: y }}
    >
      <MenuItem onClick={() => onSnooze(1)}>{t("snooze_1h")}</MenuItem>
      <MenuItem onClick={() => onSnooze(24)}>{t("snooze_24h")}</MenuItem>
      <MenuItem onClick={() => onSnooze(168)}>{t("snooze_1w")}</MenuItem>
      <div className="my-1 h-px bg-[hsl(var(--border))]" />
      <MenuItem onClick={onDismissPerm} variant="danger">
        {t("dismiss_permanent")}
      </MenuItem>
      {onIgnoreSender ? (
        <MenuItem onClick={onIgnoreSender} variant="danger" icon={<BellOff size={13} strokeWidth={1.75} />}>
          {t("ignore_sender")}
        </MenuItem>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "danger";
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-hover hover:bg-[hsl(var(--surface-raised))]",
        variant === "danger"
          ? "text-[hsl(var(--destructive))]"
          : "text-[hsl(var(--foreground))]"
      )}
    >
      {icon ? <span aria-hidden className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

// ── Undo banner ──────────────────────────────────────────────────────
function UndoBanner({
  visible,
  onUndo,
  onExpire,
  windowSeconds,
}: {
  visible: boolean;
  onUndo: () => void;
  onExpire: () => void;
  windowSeconds: number;
}) {
  const t = useTranslations("queue.undo");
  const [remaining, setRemaining] = useState(windowSeconds);
  useEffect(() => {
    if (!visible) return;
    setRemaining(windowSeconds);
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      const left = Math.max(0, windowSeconds - elapsed);
      setRemaining(left);
      if (left === 0) {
        window.clearInterval(id);
        onExpire();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [visible, windowSeconds, onExpire]);
  if (!visible) return null;
  return (
    <div
      role="status"
      className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[12px]"
    >
      <span className="text-[hsl(var(--muted-foreground))]">
        {t("done_with_remaining", { n: remaining })}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="font-medium text-[hsl(var(--primary))] transition-hover hover:opacity-80"
      >
        {t("undo")}
      </button>
    </div>
  );
}

// ── Card shell ───────────────────────────────────────────────────────
function CardShell({
  card,
  size = "md",
  children,
  variant = "default",
  onContextMenu,
}: {
  card: QueueCard;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  variant?: "default" | "decision" | "fyi";
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const padding = size === "lg" ? "p-5" : size === "sm" ? "p-3" : "p-4";
  const variantClasses = {
    default:
      "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]",
    decision:
      "rounded-2xl border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--surface-raised))] shadow-[0_4px_20px_-8px_hsl(var(--primary)/0.18)]",
    fyi:
      "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
  }[variant];
  return (
    <article
      data-queue-card
      data-archetype={card.archetype}
      data-confidence={card.confidence}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative",
        variantClasses,
        confidenceBorderClass(card.confidence),
        padding,
        "transition-default hover:border-[hsl(var(--primary)/0.45)]"
      )}
    >
      {children}
    </article>
  );
}

function CardHeader({
  card,
  icon,
  locale,
}: {
  card: QueueCard;
  icon: ReactNode;
  locale: "en" | "ja";
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--surface))] text-[hsl(var(--primary))]"
        >
          {icon}
        </span>
        <h3 className="truncate text-[14px] font-semibold text-[hsl(var(--foreground))]">
          {card.title}
        </h3>
      </div>
      <span
        className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
        title={new Date(card.createdAt).toLocaleString()}
      >
        {formatRelative(card.createdAt, locale)}
      </span>
    </header>
  );
}

function CardFooter({ card }: { card: QueueCard }) {
  if (card.sources.length === 0 && !card.originHref) return null;
  // External origin URLs (Gmail web, Google Calendar) open in a new tab
  // so the user keeps their Steadii queue context. Internal app paths
  // navigate in-tab as usual. See isExternalOriginHref for the
  // detection rule.
  const isExternal = isExternalOriginHref(card.originHref);
  return (
    <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[hsl(var(--border))] pt-3">
      {card.sources.slice(0, 4).map((s, i) => (
        <SourceChip key={`${s.kind}-${i}`} source={s} />
      ))}
      {card.sources.length > 4 ? (
        <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          +{card.sources.length - 4}
        </span>
      ) : null}
      {card.originHref ? (
        <a
          href={card.originHref}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <span>{card.originLabel ?? "open"}</span>
          <ChevronRight size={12} strokeWidth={1.75} />
        </a>
      ) : null}
    </footer>
  );
}

// Quick-menu controller used by every archetype. Encapsulates the
// right-click / long-press → menu show + menu close cycle so each
// archetype subcomponent only wires the menu actions.
function useQuickMenu({
  onSnooze,
  onPermanentDismiss,
  onIgnoreSender,
}: {
  onSnooze: (hours: number) => Promise<ActionResult> | ActionResult;
  onPermanentDismiss: () => Promise<ActionResult> | ActionResult;
  // 今後この送信者を無視 — optional; when omitted the menu item is hidden.
  onIgnoreSender?: () => Promise<ActionResult> | ActionResult;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      setMenu({ x, y });
    }, 550);
  };
  const onTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  return {
    bindings: {
      onContextMenu,
      onTouchStart,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
      onTouchMove: onTouchEnd,
    },
    menu: (
      <QuickMenu
        visible={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        onSnooze={(hours) => {
          setMenu(null);
          void onSnooze(hours);
        }}
        onDismissPerm={() => {
          setMenu(null);
          void onPermanentDismiss();
        }}
        onIgnoreSender={
          onIgnoreSender
            ? () => {
                setMenu(null);
                void onIgnoreSender();
              }
            : undefined
        }
      />
    ),
  };
}

// ── Type A — Decision-required ───────────────────────────────────────
export function QueueCardARender({
  card,
  onPickOption,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onMarkHandled,
  onUndo,
  undoWindowSeconds,
}: CardAProps) {
  const t = useTranslations("queue.card_a");
  const tShared = useTranslations("queue.shared");
  const tDispo = useTranslations("queue.card_b_disposition");
  const tNot = useTranslations("notifications");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const undoWindow = undoWindowSeconds ?? 10;
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const pick = (key: string) => {
    if (pending || resolved) return;
    startTransition(async () => {
      const result = await onPickOption(key);
      const token = isUndoResult(result) ? result.undoToken : undefined;
      if (token && card.reversible) {
        setUndoToken(token);
      }
      setResolved(true);
    });
  };

  const markHandled = () => {
    if (!onMarkHandled || pending || resolved) return;
    setResolved(true);
    startTransition(async () => {
      try {
        await onMarkHandled();
      } catch {
        setResolved(false);
      }
    });
  };

  return (
    <>
      <CardShell card={card} size="lg" variant="decision" onContextMenu={bindings.onContextMenu}>
        <div
          {...bindings}
          aria-disabled={resolved}
          className={cn(resolved && "opacity-60")}
        >
          <CardHeader
            card={card}
            icon={<AlertTriangle size={14} strokeWidth={2} />}
            locale={locale}
          />
          {card.body ? (
            <p className="mt-2 text-[13px] leading-snug text-[hsl(var(--foreground))]">
              {card.body}
            </p>
          ) : null}
          {card.confidence === "low" ? (
            <p className="mt-2 text-[12px] italic text-[hsl(var(--muted-foreground))]">
              {tShared("verify_recommended")}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {card.options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                disabled={pending || resolved}
                onClick={() => pick(opt.key)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium transition-default",
                  opt.recommended
                    ? "bg-[hsl(var(--foreground))] text-[hsl(var(--surface))] hover:opacity-90"
                    : "border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]",
                  (pending || resolved) && "opacity-50"
                )}
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
            {onMarkHandled ? (
              <button
                type="button"
                onClick={markHandled}
                disabled={pending || resolved}
                className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
              >
                {tDispo("resolved")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onDismiss()}
              disabled={pending || resolved}
              className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              aria-label={tNot("snooze_24h_aria")}
            >
              {t("dismiss")}
            </button>
          </div>
          <CardFooter card={card} />
        </div>
        <UndoBanner
          visible={undoToken !== null}
          windowSeconds={undoWindow}
          onUndo={() => {
            const token = undoToken;
            if (!token) return;
            setUndoToken(null);
            void onUndo?.(token);
            setResolved(false);
          }}
          onExpire={() => setUndoToken(null)}
        />
      </CardShell>
      {menu}
    </>
  );
}

// ── Type B — Draft-ready ─────────────────────────────────────────────
export function QueueCardBRender({
  card,
  onReview,
  onSend,
  onSecondaryAction,
  onSetDisposition,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onIgnoreSender,
  onUndo,
  isSendingPending = false,
  undoWindowSeconds,
}: CardBProps) {
  const t = useTranslations("queue.card_b");
  const tDispo = useTranslations("queue.card_b_disposition");
  const tShared = useTranslations("queue.shared");
  const tSecondary = useTranslations("queue.card_b_secondary");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const { bindings, menu } = useQuickMenu({
    onSnooze,
    onPermanentDismiss,
    onIgnoreSender: card.ignorableSender ? onIgnoreSender : undefined,
  });
  // PR 2 — effective dim/disabled state. When the parent's inline-send
  // timer is running for this card, the card dims like a resolved card
  // but the source of truth is the parent (so undo can flip it back).
  const effectiveResolved = resolved || isSendingPending;

  const labelFor = (sa: { key: string; label: string }): string => {
    // Known keys come from the queue builder (server-side, English).
    // Unknown keys (e.g. dev-preview mocks, future variants) fall back
    // to the server label so the UI never renders blank.
    switch (sa.key) {
      case "open_detail":
        return tSecondary("open_detail");
      case "open_calendar":
        return tSecondary("open_calendar");
      case "mark_reviewed":
        return tSecondary("mark_reviewed");
      default:
        return sa.label;
    }
  };

  const send = () => {
    if (pending || effectiveResolved) return;
    startTransition(async () => {
      const result = await onSend();
      const token = isUndoResult(result) ? result.undoToken : undefined;
      if (token) setUndoToken(token);
      // PR 2 — for the inline-send flow the parent owns the dim state
      // via isSendingPending; we still flip local resolved so a
      // double-click during transition is a no-op via the guard above.
      setResolved(true);
    });
  };

  const isInformational = card.mode === "informational";
  const headerIcon = isInformational ? (
    <CalendarIcon size={14} strokeWidth={2} />
  ) : (
    <Mail size={14} strokeWidth={2} />
  );

  const runSecondary = (key: string) => {
    if (!onSecondaryAction || pending || effectiveResolved) return;
    startTransition(async () => {
      await onSecondaryAction(key);
      setResolved(true);
    });
  };

  // PR 3 — disposition row. 'resolved' / 'skipped' fire optimistically;
  // 'ignored' first surfaces a native confirm dialog because the user
  // can't recover from "never re-surface" without manual DB work. We
  // use window.confirm here because the rest of the queue surface
  // doesn't have a shadcn Dialog primitive yet and adding one for a
  // single destructive gate would be larger than this PR scope.
  const setDisposition = (
    disposition: "resolved" | "skipped" | "ignored"
  ) => {
    if (!onSetDisposition || pending || effectiveResolved) return;
    if (disposition === "ignored") {
      const ok =
        typeof window !== "undefined"
          ? window.confirm(tDispo("ignored_confirm"))
          : true;
      if (!ok) return;
    }
    // Optimistically dim the card so it disappears from the UI on the
    // same tick. The server action's refresh re-pulls the queue; on
    // failure the parent restores the card by re-running refresh.
    setResolved(true);
    startTransition(async () => {
      try {
        await onSetDisposition(disposition);
      } catch {
        // Parent surfaced the toast; let the un-resolve happen via
        // the refresh in the parent's catch path.
        setResolved(false);
      }
    });
  };

  // PR 2 — when the parent stops the inline-send timer (user clicked
  // undo within the 10s window), the local resolved flag from the
  // optimistic transition above needs to fall back to false so the
  // card buttons re-enable. Without this the row stays dim+disabled
  // even though the toast vanished.
  useEffect(() => {
    if (!isSendingPending && resolved) {
      // Only auto-un-resolve when the local flag was set BECAUSE of an
      // inline-send transition. Heuristic: we never call setResolved
      // synchronously without isSendingPending also flipping true on
      // the same tick (the parent toggles it before the transition
      // resolves). Safe to reset here.
      setResolved(false);
    }
    // We intentionally depend on isSendingPending only — local resolved
    // changes are driven by user clicks, not by parent prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSendingPending]);

  return (
    <>
      <CardShell card={card} size="md" variant="default" onContextMenu={bindings.onContextMenu}>
        <div {...bindings} className={cn(effectiveResolved && "opacity-60")}>
          <CardHeader card={card} icon={headerIcon} locale={locale} />
          {card.body ? (
            <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
              {card.body}
            </p>
          ) : null}
          {card.mode === "draft" ? (
            <>
              {card.inboundSnippet ? (
                <div className="mt-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    {t("inbound_label")}
                  </div>
                  <p className="line-clamp-3 text-[12px] leading-snug text-[hsl(var(--foreground))]">
                    {card.inboundSnippet}
                  </p>
                </div>
              ) : null}
              <div className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("draft_label")}
                </div>
                {card.subjectLine ? (
                  <p className="mb-1 text-[12px] font-medium text-[hsl(var(--foreground))]">
                    {card.subjectLine}
                  </p>
                ) : null}
                {card.toLabel ? (
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {card.toLabel}
                  </p>
                ) : null}
                <p className="line-clamp-3 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                  {card.draftPreview}
                </p>
              </div>
            </>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
              {card.bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[12px] leading-snug text-[hsl(var(--foreground))]"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]"
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {card.confidence === "low" ? (
            <p className="mt-2 text-[12px] italic text-[hsl(var(--muted-foreground))]">
              {tShared("verify_recommended")}
            </p>
          ) : null}
          {/*
            Primary action row for Draft mode: [Review] [Send (primary)]
            [...spacer] [Skip].

            PR 3 placeholder — disposition trio (対応済み / スキップ / 無視中)
            will land as a SECONDARY action row, rendered immediately
            below this primary row. The disposition row should be
            visually smaller (h-7 vs h-9 here), use ghost/outline styling
            for 対応済み + スキップ, and a destructive variant for 無視中
            (with a confirm dialog). Slot the new row right after the
            closing `</div>` of this primary row, before <CardFooter />.
          */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {card.mode === "draft" ? (
              <>
                <button
                  type="button"
                  onClick={onReview}
                  disabled={pending || effectiveResolved}
                  className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
                >
                  {t("review")}
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={pending || effectiveResolved}
                  className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-4 text-[13px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles size={12} strokeWidth={2} />
                  <span>{t("send")}</span>
                </button>
              </>
              /*
                2026-05-25 — Top-row Skip + × were removed on Draft cards.
                The 3-way disposition row below ([対応済み][スキップ][無視])
                already covers "skip 24h" + "stop showing" + "I handled it"
                with clearer semantics; the duplicate top-row affordances
                were confusing (two "Skip" buttons on the same card).
                Informational cards still render the × so the user can
                dismiss notify-only / pre-brief cards.
              */
            ) : (
              <>
                {card.secondaryActions.map((sa) =>
                  sa.href ? (
                    <a
                      key={sa.key}
                      href={sa.href}
                      className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
                    >
                      {labelFor(sa)}
                    </a>
                  ) : (
                    <button
                      key={sa.key}
                      type="button"
                      onClick={() => runSecondary(sa.key)}
                      disabled={pending || effectiveResolved}
                      className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
                    >
                      {labelFor(sa)}
                    </button>
                  )
                )}
              </>
            )}
            {card.mode === "draft" ? null : (
              <button
                type="button"
                onClick={() => void onDismiss()}
                disabled={pending || effectiveResolved}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-2 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]",
                  card.mode === "informational" && "ml-auto"
                )}
                aria-label={t("dismiss")}
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            )}
          </div>
          {/*
            PR 3 — secondary disposition row. Renders ONLY on Draft mode
            and only when a setter is wired. Three buttons:
              対応済み — neutral filled (handled it via Gmail directly)
              スキップ — ghost (not now; re-surfaces after 24h)
              無視中  — destructive (gated by window.confirm)
          */}
          {card.mode === "draft" && onSetDisposition ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDisposition("resolved")}
                disabled={pending || effectiveResolved}
                className="inline-flex h-7 items-center rounded-full bg-[hsl(var(--surface-raised))] px-3 text-[12px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface))] disabled:opacity-50"
              >
                {tDispo("resolved")}
              </button>
              <button
                type="button"
                onClick={() => setDisposition("skipped")}
                disabled={pending || effectiveResolved}
                className="inline-flex h-7 items-center rounded-full border border-[hsl(var(--border))] px-3 text-[12px] text-[hsl(var(--muted-foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {tDispo("skipped")}
              </button>
              <button
                type="button"
                onClick={() => setDisposition("ignored")}
                disabled={pending || effectiveResolved}
                className="inline-flex h-7 items-center rounded-full border border-[hsl(var(--destructive)/0.3)] px-3 text-[12px] text-[hsl(var(--destructive))] transition-default hover:bg-[hsl(var(--destructive)/0.08)] disabled:opacity-50"
              >
                {tDispo("ignored")}
              </button>
            </div>
          ) : null}
          <CardFooter card={card} />
        </div>
        <UndoBanner
          visible={undoToken !== null}
          windowSeconds={undoWindowSeconds ?? 10}
          onUndo={() => {
            const token = undoToken;
            if (!token) return;
            setUndoToken(null);
            void onUndo?.(token);
            setResolved(false);
          }}
          onExpire={() => setUndoToken(null)}
        />
      </CardShell>
      {menu}
    </>
  );
}

// ── Type C — Soft notice ─────────────────────────────────────────────
export function QueueCardCRender({
  card,
  onTakeAction,
  onMarkHandled,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onIgnoreSender,
}: CardCProps) {
  const tShared = useTranslations("queue.shared");
  const tDispo = useTranslations("queue.card_b_disposition");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const { bindings, menu } = useQuickMenu({
    onSnooze,
    onPermanentDismiss,
    onIgnoreSender: card.ignorableSender ? onIgnoreSender : undefined,
  });

  const takeAction = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onTakeAction();
      setResolved(true);
    });
  };

  const markHandled = () => {
    if (!onMarkHandled || pending || resolved) return;
    setResolved(true);
    startTransition(async () => {
      try {
        await onMarkHandled();
      } catch {
        setResolved(false);
      }
    });
  };

  // When mark-handled is wired (FYI / "返信不要" notices), 確認済み is the
  // PRIMARY affordance and 対応する drops to a de-emphasized secondary —
  // a filled "Take action" CTA on a no-reply notice is contradictory.
  // Without it (legacy callers), keep the original 対応する-primary layout.
  const fyiPrimary = Boolean(onMarkHandled);

  return (
    <>
      <CardShell card={card} size="sm" variant="default" onContextMenu={bindings.onContextMenu}>
        <div {...bindings} className={cn(resolved && "opacity-60")}>
          <CardHeader
            card={card}
            icon={<Sparkles size={13} strokeWidth={1.75} />}
            locale={locale}
          />
          {card.body ? (
            <p className="mt-1.5 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
              {card.body}
            </p>
          ) : null}
          {card.confidence === "low" ? (
            <p className="mt-1.5 text-[11px] italic text-[hsl(var(--muted-foreground))]">
              {tShared("verify_recommended")}
            </p>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            {fyiPrimary ? (
              <>
                <button
                  type="button"
                  onClick={markHandled}
                  disabled={pending || resolved}
                  className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
                >
                  {tDispo("resolved")}
                </button>
                <button
                  type="button"
                  onClick={takeAction}
                  disabled={pending || resolved}
                  className="inline-flex h-8 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
                >
                  {card.primaryActionLabel}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={takeAction}
                disabled={pending || resolved}
                className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
              >
                {card.primaryActionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onDismiss()}
              disabled={pending || resolved}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-2 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]",
                fyiPrimary && "ml-auto"
              )}
            >
              {tShared("dismiss")}
            </button>
          </div>
          <CardFooter card={card} />
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// ── Type D — FYI / completed ─────────────────────────────────────────
export function QueueCardDRender({
  card,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onUndo,
}: CardDProps) {
  const t = useTranslations("queue.card_d");
  const locale = useLocaleHint();
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const undoableNow =
    card.undoableUntil &&
    new Date(card.undoableUntil).getTime() > Date.now() &&
    onUndo !== undefined;

  return (
    <>
      <CardShell card={card} size="sm" variant="fyi" onContextMenu={bindings.onContextMenu}>
        <div
          {...bindings}
          className="flex items-center gap-3 text-[12px] text-[hsl(var(--muted-foreground))]"
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--surface-raised))] text-[hsl(var(--primary))]"
          >
            <Check size={12} strokeWidth={2} />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {card.actionVerb}
          </span>
          <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
            {card.title}
          </span>
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums"
            title={new Date(card.createdAt).toLocaleString()}
          >
            {formatRelative(card.createdAt, locale)}
          </span>
          {card.detailHref ? (
            <a
              href={card.detailHref}
              className="inline-flex h-6 items-center rounded px-1.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("detail")}
            </a>
          ) : null}
          {undoableNow ? (
            <button
              type="button"
              onClick={() => void onUndo?.(card.id)}
              className="inline-flex h-6 items-center rounded px-1.5 text-[11px] font-medium text-[hsl(var(--primary))] transition-hover hover:opacity-80"
            >
              {t("undo")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onDismiss()}
              className="inline-flex h-6 items-center rounded px-1.5 text-[11px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              aria-label={t("dismiss")}
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// ── Type E — Clarifying input ────────────────────────────────────────
export function QueueCardERender({
  card,
  onSubmit,
  onTalkInChat,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onIgnoreSender,
}: CardEProps) {
  const t = useTranslations("queue.card_e");
  const tShared = useTranslations("queue.shared");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const { bindings, menu } = useQuickMenu({
    onSnooze,
    onPermanentDismiss,
    onIgnoreSender: card.ignorableSender ? onIgnoreSender : undefined,
  });

  const canSubmit = (picked !== null || freeText.trim().length > 0) && !resolved;

  const submit = () => {
    if (!canSubmit || pending) return;
    startTransition(async () => {
      await onSubmit(picked, freeText.trim());
      setResolved(true);
    });
  };

  const talk = () => {
    if (!onTalkInChat || pending || resolved) return;
    startTransition(async () => {
      // engineer-46 — fire-and-forget: the wrapper in queue-list.tsx
      // pushes the router to /app/chat/<id> after the action resolves;
      // we don't mark the card "resolved" here because navigation
      // unmounts the queue and Home re-fetches on return.
      await onTalkInChat();
    });
  };

  return (
    <>
      <CardShell card={card} size="md" variant="default" onContextMenu={bindings.onContextMenu}>
        <div {...bindings} className={cn(resolved && "opacity-60")}>
          <CardHeader
            card={card}
            icon={<HelpCircle size={14} strokeWidth={2} />}
            locale={locale}
          />
          {card.body ? (
            <p className="mt-2 text-[13px] leading-snug text-[hsl(var(--foreground))]">
              {card.body}
            </p>
          ) : null}
          {card.confidence === "low" ? (
            <p className="mt-1.5 text-[12px] italic text-[hsl(var(--muted-foreground))]">
              {tShared("verify_recommended")}
            </p>
          ) : null}
          <ul className="mt-3 flex flex-col gap-1.5">
            {card.choices.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[13px] transition-hover hover:bg-[hsl(var(--surface))]">
                  <input
                    type="radio"
                    name={`queue-e-${card.id}`}
                    checked={picked === c.key}
                    onChange={() => setPicked(c.key)}
                    className="mt-0.5"
                    disabled={resolved}
                  />
                  <span className="text-[hsl(var(--foreground))]">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            disabled={resolved}
            placeholder={t("free_text_placeholder")}
            rows={2}
            className="mt-2 block w-full resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5 text-[12px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || pending}
              className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
            >
              {t("submit")}
            </button>
            {onTalkInChat ? (
              <button
                type="button"
                onClick={talk}
                disabled={pending || resolved}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
              >
                <MessageCircleQuestion size={12} strokeWidth={1.75} />
                {t("talk_in_chat")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onSnooze(24)}
              disabled={pending || resolved}
              className="inline-flex h-8 items-center rounded-full px-2 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("ask_later")}
            </button>
            <button
              type="button"
              onClick={() => void onDismiss()}
              disabled={pending || resolved}
              className="inline-flex h-8 items-center rounded-full px-2 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("reject")}
            </button>
            {locale === "ja" ? (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                <Clock size={11} />
                <span>{t("response_pending")}</span>
              </span>
            ) : null}
          </div>
          <CardFooter card={card} />
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// ── Type F — Interactive confirmation (engineer-42) ──────────────────
export function QueueCardFRender({
  card,
  onConfirm,
  onCorrect,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
}: CardFProps) {
  const t = useTranslations("queue.card_f");
  const tShared = useTranslations("queue.shared");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctedValue, setCorrectedValue] = useState("");
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const confirmLabel = card.inferredValue
    ? t("confirm_with_value", { value: card.inferredValue })
    : t("confirm");

  const confirm = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onConfirm();
      setResolved(true);
    });
  };

  const submitCorrection = () => {
    const value = correctedValue.trim();
    if (!value || pending || resolved) return;
    startTransition(async () => {
      await onCorrect(value);
      setResolved(true);
      setCorrecting(false);
    });
  };

  const dismiss = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onDismiss();
      setResolved(true);
    });
  };

  return (
    <>
      <CardShell
        card={card}
        size="md"
        variant="decision"
        onContextMenu={bindings.onContextMenu}
      >
        <div
          {...bindings}
          aria-disabled={resolved}
          className={cn(resolved && "opacity-60")}
        >
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--surface))] text-[hsl(var(--primary))]"
              >
                <MessageCircleQuestion size={14} strokeWidth={2} />
              </span>
              <h3 className="text-[15px] font-semibold leading-snug text-[hsl(var(--foreground))]">
                {card.title}
              </h3>
            </div>
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
              title={new Date(card.createdAt).toLocaleString()}
            >
              {formatRelative(card.createdAt, locale)}
            </span>
          </header>
          {card.body ? (
            <p className="mt-2 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
              {card.body}
            </p>
          ) : null}
          {correcting ? (
            <div className="mt-3 flex flex-col gap-2">
              <input
                type="text"
                value={correctedValue}
                onChange={(e) => setCorrectedValue(e.target.value)}
                disabled={resolved || pending}
                placeholder={t("correct_placeholder")}
                autoFocus
                className="block w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5 text-[13px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCorrection();
                  else if (e.key === "Escape") {
                    setCorrecting(false);
                    setCorrectedValue("");
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitCorrection}
                  disabled={
                    correctedValue.trim().length === 0 || pending || resolved
                  }
                  className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
                >
                  {t("save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCorrecting(false);
                    setCorrectedValue("");
                  }}
                  disabled={pending || resolved}
                  className="inline-flex h-8 items-center rounded-full px-3 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
                >
                  {tShared("dismiss")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={pending || resolved}
                data-testid="queue-card-f-confirm"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-4 text-[13px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
              >
                <Check size={12} strokeWidth={2} />
                <span>{confirmLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => setCorrecting(true)}
                disabled={pending || resolved}
                data-testid="queue-card-f-correct"
                className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
              >
                {t("correct")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={pending || resolved}
                data-testid="queue-card-f-dismiss"
                className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {t("dismiss")}
              </button>
            </div>
          )}
          <CardFooter card={card} />
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// Dispatcher — picks the right renderer based on archetype and forwards
// the typed props. Lets parents render a generic `QueueCard` array
// without per-archetype switch statements.
//
// `onAction` is a typed callback union per archetype; we don't try to
// over-unify the per-archetype APIs because each archetype has different
// action shapes.
export type QueueCardActions = {
  onPickOption?: CardAProps["onPickOption"];
  onReview?: CardBProps["onReview"];
  onSend?: CardBProps["onSend"];
  onSecondaryAction?: CardBProps["onSecondaryAction"];
  onSetDisposition?: CardBProps["onSetDisposition"];
  onTakeAction?: CardCProps["onTakeAction"];
  onSubmit?: CardEProps["onSubmit"];
  onTalkInChat?: CardEProps["onTalkInChat"];
  onConfirm?: CardFProps["onConfirm"];
  onCorrect?: CardFProps["onCorrect"];
  onAddToCalendar?: CardGProps["onAddToCalendar"];
  onEditProposal?: CardGProps["onEditProposal"];
  onDismissProposal?: CardGProps["onDismissProposal"];
  // 2026-05-24 — Type H propose-archive batch actions.
  onArchiveAll?: CardHProps["onArchiveAll"];
  onArchiveSelected?: CardHProps["onArchiveSelected"];
  onCancelAll?: CardHProps["onCancelAll"];
  onDismiss: CommonProps["onDismiss"];
  onSnooze: CommonProps["onSnooze"];
  onPermanentDismiss: CommonProps["onPermanentDismiss"];
  // 今後この送信者を無視 — forwarded to Type B/C/E renderers, which gate
  // the menu item on card.ignorableSender being present.
  onIgnoreSender?: CommonProps["onIgnoreSender"];
  onUndo?: CommonProps["onUndo"];
  // 確認済み — neutral mark-handled, wired on non-draft judgment/FYI
  // cards (Type A / Type C). Forwarded to those renderers below.
  onMarkHandled?: CommonProps["onMarkHandled"];
  // 2026-06-09 — Type B Draft only. True while the server-side send is
  // in flight or inside the undo window; the card dims + disables its
  // buttons. The send is already committed server-side, so unmounting
  // can't drop it.
  isSendingPending?: boolean;
  // Per-user undo window for the Undo banner countdown (Type A + B).
  undoWindowSeconds?: number;
};

export function QueueCardRenderer({
  card,
  actions,
}: {
  card: QueueCard;
  actions: QueueCardActions;
}) {
  switch (card.archetype) {
    case "A":
      return (
        <QueueCardARender
          card={card}
          onPickOption={actions.onPickOption ?? noopAsync}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onMarkHandled={actions.onMarkHandled}
          onUndo={actions.onUndo}
          undoWindowSeconds={actions.undoWindowSeconds}
        />
      );
    case "B":
      return (
        <QueueCardBRender
          card={card}
          onReview={actions.onReview ?? noop}
          onSend={actions.onSend ?? noopAsync}
          onSecondaryAction={actions.onSecondaryAction}
          onSetDisposition={actions.onSetDisposition}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onIgnoreSender={actions.onIgnoreSender}
          onUndo={actions.onUndo}
          isSendingPending={actions.isSendingPending}
          undoWindowSeconds={actions.undoWindowSeconds}
        />
      );
    case "C":
      return (
        <QueueCardCRender
          card={card}
          onTakeAction={actions.onTakeAction ?? noopAsync}
          onMarkHandled={actions.onMarkHandled}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onIgnoreSender={actions.onIgnoreSender}
        />
      );
    case "D":
      return (
        <QueueCardDRender
          card={card}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onUndo={actions.onUndo}
        />
      );
    case "E":
      return (
        <QueueCardERender
          card={card}
          onSubmit={actions.onSubmit ?? noopSubmit}
          onTalkInChat={actions.onTalkInChat}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onIgnoreSender={actions.onIgnoreSender}
        />
      );
    case "F":
      return (
        <QueueCardFRender
          card={card}
          onConfirm={actions.onConfirm ?? noopAsync}
          onCorrect={actions.onCorrect ?? noopAsyncCorrect}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
        />
      );
    case "G":
      return (
        <QueueCardGRender
          card={card}
          onAddToCalendar={actions.onAddToCalendar ?? noopAsync}
          onEditProposal={actions.onEditProposal ?? noopAsyncEdit}
          onDismissProposal={actions.onDismissProposal ?? noopAsync}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
        />
      );
    case "H":
      return (
        <QueueCardHRender
          card={card}
          onArchiveAll={actions.onArchiveAll ?? noopAsync}
          onArchiveSelected={actions.onArchiveSelected ?? noopAsyncSelected}
          onCancelAll={actions.onCancelAll ?? noopAsync}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
        />
      );
  }
}

// ── Type G' (auto-cal propose-confirm) ───────────────────────────────
// 2026-05-24 — PR B of Round 3. The card now mirrors the propose-confirm
// flow: nothing has touched the user's calendar yet. Three actions:
//   [カレンダーに追加] (primary, filled)
//   [編集]            (ghost — opens inline editor)
//   [破棄]            (ghost, destructive tone — no modal)
//
// The inline editor (NOT a modal) lets the user mutate date / start
// time / duration / title. For deadline-kind proposals the time
// pickers are hidden — those are all-day. Validation rules live in
// `cardGValidateEdit` and surface inline; past-date is a warning,
// not a block.

export function QueueCardGRender({
  card,
  onAddToCalendar,
  onEditProposal,
  onDismissProposal,
  onSnooze,
  onPermanentDismiss,
}: CardGProps) {
  const t = useTranslations("queue.card_g");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [editing, setEditing] = useState(false);
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const showTimePickers = cardGShouldShowTimePickers(card.kind);
  const proposalHeaderKey = cardGProposalHeaderKey(card.kind);

  // "Expires in N days" countdown re-evaluated each minute. We render
  // it iff the proposal is close to auto-dismiss (per
  // `cardGShouldShowExpiry`); the heading prose carries the main
  // proposal copy regardless.
  const [daysUntilExpiry, setDaysUntilExpiry] = useState(() =>
    cardGDaysUntilExpiry(card.graceExpiresAt),
  );
  useEffect(() => {
    const tick = () => setDaysUntilExpiry(cardGDaysUntilExpiry(card.graceExpiresAt));
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [card.graceExpiresAt]);
  const showExpiry = cardGShouldShowExpiry(daysUntilExpiry);

  const add = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onAddToCalendar();
      setResolved(true);
    });
  };

  const dismiss = () => {
    if (pending || resolved) return;
    // Per spec: no confirm modal. The cancelled row stays in DB so
    // the user can manually re-add from the original email.
    startTransition(async () => {
      await onDismissProposal();
      setResolved(true);
    });
  };

  return (
    <>
      <CardShell
        card={card}
        size="md"
        variant="decision"
        onContextMenu={bindings.onContextMenu}
      >
        <div
          {...bindings}
          aria-disabled={resolved}
          className={cn(resolved && "opacity-60")}
        >
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--surface))] text-[hsl(var(--primary))]"
              >
                <Sparkles size={14} strokeWidth={2} />
              </span>
              <h3 className="text-[15px] font-semibold leading-snug text-[hsl(var(--foreground))]">
                {t(proposalHeaderKey)}
              </h3>
            </div>
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
              title={new Date(card.createdAt).toLocaleString()}
            >
              {formatRelative(card.createdAt, locale)}
            </span>
          </header>
          <div className="mt-2 flex items-center gap-2 text-[12px] text-[hsl(var(--muted-foreground))]">
            <CalendarIcon size={12} strokeWidth={2} />
            <span className="font-medium text-[hsl(var(--foreground))]">
              {card.slotLabel}
            </span>
            {showExpiry ? (
              <>
                <span aria-hidden>·</span>
                <Clock size={12} strokeWidth={2} />
                <span>{t("expires_in_days", { days: daysUntilExpiry ?? 0 })}</span>
              </>
            ) : null}
          </div>
          {card.body ? (
            <p className="mt-2 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
              {card.body}
            </p>
          ) : null}
          {editing ? (
            <CardGEditor
              card={card}
              showTimePickers={showTimePickers}
              pending={pending}
              onCancel={() => setEditing(false)}
              onCommit={(updates) => {
                if (pending || resolved) return;
                startTransition(async () => {
                  await onEditProposal(updates);
                  // Chain straight into Add per spec — the editor's
                  // primary CTA is [更新して追加]. The server has merged
                  // the slot now, so the calendarCreateEvent in
                  // onAddToCalendar uses the freshly persisted shape.
                  await onAddToCalendar();
                  setResolved(true);
                  setEditing(false);
                });
              }}
            />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={add}
                disabled={pending || resolved}
                data-testid="queue-card-g-add"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--primary))] px-4 text-[13px] font-medium text-[hsl(var(--primary-foreground))] transition-default hover:opacity-90 disabled:opacity-50"
              >
                <CalendarIcon size={12} strokeWidth={2} />
                <span>{t("add_to_calendar")}</span>
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={pending || resolved}
                data-testid="queue-card-g-edit"
                className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
              >
                {t("edit")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={pending || resolved}
                data-testid="queue-card-g-dismiss"
                className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))] disabled:opacity-50"
              >
                {t("dismiss")}
              </button>
            </div>
          )}
          <CardFooter card={card} />
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// Inline editor. Pre-fills from the slot label the server already
// computed for the card (we don't re-parse — the slot's raw fields
// are passed through via the card's other props). For deadline-kind
// proposals we render only date + title.
function CardGEditor({
  card,
  showTimePickers,
  pending,
  onCancel,
  onCommit,
}: {
  card: QueueCardG;
  showTimePickers: boolean;
  pending: boolean;
  onCancel: () => void;
  onCommit: (updates: CardGEditPatch) => void;
}) {
  const t = useTranslations("queue.card_g");
  // The card's slotLabel is locale-pretty (e.g. "5/30 (金) 14:00 JST")
  // — not parseable back into ISO. The DB-side shape is what the
  // editor needs to mutate; we pull initial fields from the card's
  // structured fields rather than rendering an empty form.
  //
  // For deadline-kind proposals the durationMin is 0; the editor never
  // shows a start time. For mutual_agreement the start time is
  // required (the proposal-detector won't propose a timed event
  // without one).
  const initialSlot = parseCardSlotForEditor(card);
  const [date, setDate] = useState(initialSlot.date);
  const [startTime, setStartTime] = useState(initialSlot.startTime ?? "");
  const [durationMin, setDurationMin] = useState<number>(
    initialSlot.durationMin ?? 30,
  );
  const [title, setTitle] = useState(initialSlot.title ?? "");

  const validation = cardGValidateEdit({
    kind: card.kind,
    date,
    startTime: showTimePickers ? startTime || undefined : undefined,
    durationMin: showTimePickers ? durationMin : 0,
  });
  const hasError = !validation.ok;
  const warningKey =
    validation.ok && "warning" in validation
      ? (validation as { warning: "validation_past_date_warning" }).warning
      : null;

  const submit = () => {
    if (hasError || pending) return;
    const patch = cardGBuildEditPatch({
      kind: card.kind,
      initial: {
        date: initialSlot.date,
        startTime: initialSlot.startTime,
        durationMin: initialSlot.durationMin,
        title: initialSlot.title,
      },
      next: {
        date,
        startTime,
        durationMin,
        title,
      },
    });
    onCommit(patch);
  };

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <label className="flex flex-col gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
        <span>{t("editor_title_label")}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          maxLength={200}
          data-testid="queue-card-g-editor-title"
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1.5 text-[13px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
        <span>{t("editor_date_label")}</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={pending}
          data-testid="queue-card-g-editor-date"
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1.5 text-[13px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
        />
      </label>
      {showTimePickers ? (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
            <span>{t("editor_start_time_label")}</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={pending}
              data-testid="queue-card-g-editor-start"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1.5 text-[13px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
            <span>{t("editor_duration_label")}</span>
            <input
              type="number"
              min={0}
              max={24 * 60}
              step={15}
              value={durationMin}
              onChange={(e) => {
                const next = parseInt(e.target.value, 10);
                setDurationMin(Number.isFinite(next) ? next : 0);
              }}
              disabled={pending}
              data-testid="queue-card-g-editor-duration"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1.5 text-[13px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
            />
          </label>
        </div>
      ) : null}
      {hasError ? (
        <p
          role="alert"
          className="text-[12px] text-[hsl(var(--destructive))]"
        >
          {t(validation.error)}
        </p>
      ) : warningKey ? (
        <p className="text-[12px] italic text-[hsl(var(--muted-foreground))]">
          {t(warningKey)}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={hasError || pending}
          data-testid="queue-card-g-editor-commit"
          className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--primary))] px-3 text-[12px] font-medium text-[hsl(var(--primary-foreground))] transition-default hover:opacity-90 disabled:opacity-50"
        >
          {t("update_and_add")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          data-testid="queue-card-g-editor-cancel"
          className="inline-flex h-8 items-center rounded-full px-3 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {t("cancel_edit")}
        </button>
      </div>
    </div>
  );
}

// Pull the raw editable fields out of the card. The builder injects
// `editorSlot` with the structured fields the editor mutates; this
// helper just unwraps + maps to the editor's local-state shape.
function parseCardSlotForEditor(card: QueueCardG): {
  date: string;
  startTime: string | null;
  durationMin: number;
  title: string;
} {
  const slot = card.editorSlot;
  return {
    date: slot.date,
    startTime: card.kind === "deadline" ? null : slot.startTime,
    durationMin: card.kind === "deadline" ? 0 : slot.durationMin,
    title: slot.title ?? "",
  };
}

// ── Type H (auto-archive batch propose-confirm) ──────────────────────
// 2026-05-24 — Round 4. The card collapses every currently-proposed
// auto-archive into one batched confirmation. Three actions: archive
// all, review individually (expandable inline list with per-item
// checkboxes + [選択した N 件をアーカイブ]), or cancel all (clears
// flags without archiving). Renderer-only; data shape + sort live in
// `lib/agent/queue/build.ts`.

const PREVIEW_LIMIT = 3;

export function QueueCardHRender({
  card,
  onArchiveAll,
  onArchiveSelected,
  onCancelAll,
  onSnooze,
  onPermanentDismiss,
}: CardHProps) {
  const t = useTranslations("queue.card_h");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  // Soonest-expiry indicator — re-eval each minute so the card flips
  // its "expires soon" pill once the oldest item's 7d window enters
  // the 1d threshold. The renderer pulls from the helper rather than
  // re-deriving so the threshold rule stays in one place.
  const [daysUntilExpiry, setDaysUntilExpiry] = useState(() =>
    cardHDaysUntilExpiry(card.soonestExpiresAt),
  );
  useEffect(() => {
    const tick = () => setDaysUntilExpiry(cardHDaysUntilExpiry(card.soonestExpiresAt));
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [card.soonestExpiresAt]);
  const showExpiry = cardHShouldShowExpiry(daysUntilExpiry);

  const archiveAll = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onArchiveAll();
      setResolved(true);
    });
  };

  const cancelAll = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onCancelAll();
      setResolved(true);
    });
  };

  const archiveSelected = () => {
    if (pending || resolved || selected.size === 0) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      await onArchiveSelected(ids);
      setResolved(true);
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const previewItems = reviewing ? card.items : card.items.slice(0, PREVIEW_LIMIT);
  const overflow = Math.max(0, card.totalCount - PREVIEW_LIMIT);
  // i18n: pluralized summary. We don't have full ICU plural support
  // here so a manual branch on n===1 keeps the en/ja copy natural.
  const summary =
    card.totalCount === 1
      ? t("summary_one")
      : t("summary", { n: card.totalCount });

  return (
    <>
      <CardShell
        card={card}
        size="md"
        variant="default"
        onContextMenu={bindings.onContextMenu}
      >
        <div
          {...bindings}
          aria-disabled={resolved}
          className={cn(resolved && "opacity-60")}
        >
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]"
              >
                <Archive size={14} strokeWidth={2} />
              </span>
              <h3 className="text-[14px] font-semibold leading-snug text-[hsl(var(--foreground))]">
                {t("header")}
              </h3>
            </div>
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]"
              title={new Date(card.createdAt).toLocaleString()}
            >
              {formatRelative(card.createdAt, locale)}
            </span>
          </header>
          <p className="mt-2 text-[13px] text-[hsl(var(--foreground))]">
            {summary}
          </p>
          {showExpiry ? (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              <Clock size={11} strokeWidth={2} />
              <span>{t("expires_soon")}</span>
            </div>
          ) : null}
          {reviewing ? (
            <ul
              className="mt-3 flex max-h-[280px] flex-col gap-1.5 overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2"
              data-testid="queue-card-h-review-list"
            >
              {previewItems.map((it) => (
                <li key={it.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-hover hover:bg-[hsl(var(--surface-raised))]">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      disabled={pending || resolved}
                      className="mt-1 shrink-0"
                      data-testid={`queue-card-h-checkbox-${it.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                        {it.senderLabel}
                      </span>
                      <span className="block truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                        {it.subject ?? t("no_subject")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
              {previewItems.map((it) => (
                <li
                  key={it.id}
                  className="flex gap-2 truncate text-[12px] leading-snug text-[hsl(var(--foreground))]"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{it.senderLabel}</span>
                    <span className="ml-2 text-[hsl(var(--muted-foreground))]">
                      {it.subject ?? t("no_subject")}
                    </span>
                  </span>
                </li>
              ))}
              {overflow > 0 ? (
                <li className="pl-3 text-[11px] italic text-[hsl(var(--muted-foreground))]">
                  {t("more_overflow", { n: overflow })}
                </li>
              ) : null}
            </ul>
          )}
          {reviewing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={archiveSelected}
                disabled={pending || resolved || selected.size === 0}
                data-testid="queue-card-h-archive-selected"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-4 text-[13px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
              >
                {t("review_archive_selected", { n: selected.size })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewing(false);
                  setSelected(new Set());
                }}
                disabled={pending || resolved}
                data-testid="queue-card-h-review-close"
                className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {t("review_close")}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={archiveAll}
                disabled={pending || resolved}
                data-testid="queue-card-h-archive-all"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-4 text-[13px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
              >
                <Archive size={12} strokeWidth={2} />
                <span>{t("archive_all")}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewing(true)}
                disabled={pending || resolved}
                data-testid="queue-card-h-review-open"
                className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
              >
                {t("review_individually")}
              </button>
              <button
                type="button"
                onClick={cancelAll}
                disabled={pending || resolved}
                data-testid="queue-card-h-cancel-all"
                className="ml-auto inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {t("cancel_all")}
              </button>
            </div>
          )}
          <CardFooter card={card} />
        </div>
      </CardShell>
      {menu}
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
function isUndoResult(value: unknown): value is { undoToken: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { undoToken?: unknown }).undoToken === "string"
  );
}

const noop = () => {};
const noopAsync = async () => {};
const noopSubmit = async (_picked: string | null, _free: string) => {};
const noopAsyncCorrect = async (_value: string) => {};
const noopAsyncEdit = async (_updates: CardGEditPatch) => {};
const noopAsyncSelected = async (_ids: string[]) => {};

// next-intl's `useTranslations` doesn't expose the active locale; we
// derive it from `<html lang="…">` so the relative-time rendering and
// the JA-specific clarifying-input footer stay aligned with the user's
// chosen locale without an extra context plumbing.
function useLocaleHint(): "en" | "ja" {
  const [locale, setLocale] = useState<"en" | "ja">("en");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const lang = document.documentElement.lang.toLowerCase();
    if (lang.startsWith("ja")) setLocale("ja");
    else setLocale("en");
  }, []);
  return locale;
}
