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
  QueueSourceChip,
} from "@/lib/agent/queue/types";
import { confidenceBorderClass } from "@/lib/agent/queue/visual";

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
};

type CardAProps = CommonProps & {
  card: QueueCardA;
  onPickOption: (optionKey: string) => Promise<ActionResult> | ActionResult;
};

type CardBProps = CommonProps & {
  card: QueueCardB;
  onReview: () => void;
  onSend: () => Promise<ActionResult> | ActionResult;
  onSkip: () => Promise<ActionResult> | ActionResult;
  // Wave 3.1 — informational variant only. Fires when the user clicks
  // the [Mark reviewed] secondary action (or any other inline-action
  // secondary). The parent records the review and removes the card.
  onSecondaryAction?: (key: string) => Promise<ActionResult> | ActionResult;
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
}: {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onSnooze: (hours: number) => void;
  onDismissPerm: () => void;
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
      className="fixed z-50 w-[180px] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] py-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
      style={{ left: x, top: y }}
    >
      <MenuItem onClick={() => onSnooze(1)}>{t("snooze_1h")}</MenuItem>
      <MenuItem onClick={() => onSnooze(24)}>{t("snooze_24h")}</MenuItem>
      <MenuItem onClick={() => onSnooze(168)}>{t("snooze_1w")}</MenuItem>
      <div className="my-1 h-px bg-[hsl(var(--border))]" />
      <MenuItem onClick={onDismissPerm} variant="danger">
        {t("dismiss_permanent")}
      </MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "block w-full px-3 py-1.5 text-left text-[13px] transition-hover hover:bg-[hsl(var(--surface-raised))]",
        variant === "danger"
          ? "text-[hsl(var(--destructive))]"
          : "text-[hsl(var(--foreground))]"
      )}
    >
      {children}
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
}: {
  onSnooze: (hours: number) => Promise<ActionResult> | ActionResult;
  onPermanentDismiss: () => Promise<ActionResult> | ActionResult;
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
  onUndo,
}: CardAProps) {
  const t = useTranslations("queue.card_a");
  const tShared = useTranslations("queue.shared");
  const tNot = useTranslations("notifications");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const undoWindow = 10;
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
  onSkip,
  onSecondaryAction,
  onDismiss,
  onSnooze,
  onPermanentDismiss,
  onUndo,
}: CardBProps) {
  const t = useTranslations("queue.card_b");
  const tShared = useTranslations("queue.shared");
  const tSecondary = useTranslations("queue.card_b_secondary");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

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
    if (pending || resolved) return;
    startTransition(async () => {
      const result = await onSend();
      const token = isUndoResult(result) ? result.undoToken : undefined;
      if (token) setUndoToken(token);
      setResolved(true);
    });
  };

  const skip = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onSkip();
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
    if (!onSecondaryAction || pending || resolved) return;
    startTransition(async () => {
      await onSecondaryAction(key);
      setResolved(true);
    });
  };

  return (
    <>
      <CardShell card={card} size="md" variant="default" onContextMenu={bindings.onContextMenu}>
        <div {...bindings} className={cn(resolved && "opacity-60")}>
          <CardHeader card={card} icon={headerIcon} locale={locale} />
          {card.body ? (
            <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
              {card.body}
            </p>
          ) : null}
          {card.mode === "draft" ? (
            <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {card.mode === "draft" ? (
              <>
                <button
                  type="button"
                  onClick={onReview}
                  disabled={pending || resolved}
                  className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
                >
                  {t("review")}
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={pending || resolved}
                  className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-4 text-[13px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles size={12} strokeWidth={2} />
                  <span>{t("send")}</span>
                </button>
                <button
                  type="button"
                  onClick={skip}
                  disabled={pending || resolved}
                  className="ml-auto inline-flex h-9 items-center rounded-full px-3 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
                >
                  {t("skip")}
                </button>
              </>
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
                      disabled={pending || resolved}
                      className="inline-flex h-9 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 text-[13px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
                    >
                      {labelFor(sa)}
                    </button>
                  )
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => void onDismiss()}
              disabled={pending || resolved}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-2 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]",
                card.mode === "informational" && "ml-auto"
              )}
              aria-label={t("dismiss")}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          <CardFooter card={card} />
        </div>
        <UndoBanner
          visible={undoToken !== null}
          windowSeconds={10}
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
  onDismiss,
  onSnooze,
  onPermanentDismiss,
}: CardCProps) {
  const tShared = useTranslations("queue.shared");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const takeAction = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      await onTakeAction();
      setResolved(true);
    });
  };

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
            <button
              type="button"
              onClick={takeAction}
              disabled={pending || resolved}
              className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
            >
              {card.primaryActionLabel}
            </button>
            <button
              type="button"
              onClick={() => void onDismiss()}
              disabled={pending || resolved}
              className="inline-flex h-8 items-center rounded-full px-2 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
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
  onDismiss,
  onSnooze,
  onPermanentDismiss,
}: CardEProps) {
  const t = useTranslations("queue.card_e");
  const tShared = useTranslations("queue.shared");
  const locale = useLocaleHint();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const { bindings, menu } = useQuickMenu({ onSnooze, onPermanentDismiss });

  const canSubmit = (picked !== null || freeText.trim().length > 0) && !resolved;

  const submit = () => {
    if (!canSubmit || pending) return;
    startTransition(async () => {
      await onSubmit(picked, freeText.trim());
      setResolved(true);
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
  onSkip?: CardBProps["onSkip"];
  onSecondaryAction?: CardBProps["onSecondaryAction"];
  onTakeAction?: CardCProps["onTakeAction"];
  onSubmit?: CardEProps["onSubmit"];
  onConfirm?: CardFProps["onConfirm"];
  onCorrect?: CardFProps["onCorrect"];
  onDismiss: CommonProps["onDismiss"];
  onSnooze: CommonProps["onSnooze"];
  onPermanentDismiss: CommonProps["onPermanentDismiss"];
  onUndo?: CommonProps["onUndo"];
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
          onUndo={actions.onUndo}
        />
      );
    case "B":
      return (
        <QueueCardBRender
          card={card}
          onReview={actions.onReview ?? noop}
          onSend={actions.onSend ?? noopAsync}
          onSkip={actions.onSkip ?? noopAsync}
          onSecondaryAction={actions.onSecondaryAction}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
          onUndo={actions.onUndo}
        />
      );
    case "C":
      return (
        <QueueCardCRender
          card={card}
          onTakeAction={actions.onTakeAction ?? noopAsync}
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
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
          onDismiss={actions.onDismiss}
          onSnooze={actions.onSnooze}
          onPermanentDismiss={actions.onPermanentDismiss}
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
  }
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
