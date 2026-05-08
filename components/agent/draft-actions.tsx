"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Pencil,
  Archive,
  X,
} from "lucide-react";
import {
  approveAgentDraftAction,
  cancelPendingSendAction,
  dismissAgentDraftAction,
  saveDraftEditsAction,
} from "@/lib/agent/email/draft-actions";
import type { PreSendWarning } from "@/lib/db/schema";

// engineer-39 — server-action errors don't preserve `instanceof` across
// the boundary, so the typed PreSendCheckFailedError manifests as a
// regular Error whose `message` is a JSON envelope keyed by `name`. We
// pluck the warnings out here and route to the modal.
const PRE_SEND_CHECK_ERROR_NAME = "PreSendCheckFailedError";

function tryParsePreSendError(
  err: unknown
): { warnings: PreSendWarning[] } | null {
  if (!(err instanceof Error)) return null;
  if (err.name !== PRE_SEND_CHECK_ERROR_NAME) return null;
  try {
    const parsed = JSON.parse(err.message) as {
      name?: string;
      warnings?: unknown;
    };
    if (parsed?.name !== PRE_SEND_CHECK_ERROR_NAME) return null;
    if (!Array.isArray(parsed.warnings)) return null;
    const warnings = parsed.warnings
      .filter(
        (w): w is { phrase: unknown; why: unknown } =>
          !!w && typeof w === "object"
      )
      .map((w) => ({
        phrase: typeof w.phrase === "string" ? w.phrase : "",
        why: typeof w.why === "string" ? w.why : "",
      }))
      .filter((w) => w.phrase.length > 0 && w.why.length > 0);
    return { warnings };
  } catch {
    return null;
  }
}
// `snoozeAgentDraftAction` server action + the LLM's `snooze` action proposal
// are intentionally kept in the backend. The Snooze BUTTON is removed from
// the UI for α because we don't yet have auto-resurface (no cron re-opens
// snoozed items at their resolvedAt). Without auto-resurface, Snooze was
// just an extended Dismiss with a broken UX promise. W4 can reintroduce the
// button once auto-resurface ships.

type Status =
  | "pending"
  | "edited"
  | "approved"
  | "sent"
  | "sent_pending"
  | "dismissed"
  | "paused"
  | "expired";

export function DraftActions({
  draftId,
  status,
  action,
  initialSubject,
  initialBody,
  initialTo,
  initialCc,
  undoWindowSeconds,
  sentAt,
  autoSent,
}: {
  draftId: string;
  status: Status;
  action:
    | "draft_reply"
    | "archive"
    | "snooze"
    | "no_op"
    | "ask_clarifying"
    | "notify_only"
    | "paused";
  initialSubject: string;
  initialBody: string;
  initialTo: string[];
  initialCc: string[];
  undoWindowSeconds: number;
  // Populated by the cron when the queued send actually goes out via Gmail.
  // Drives the "Sent · timestamp" banner; falsy for any non-sent state.
  sentAt: Date | null;
  // True when the L2 orchestrator enqueued the send without a human Send
  // click (W4.3 staged autonomy). The Sent banner labels these distinctly
  // so the glass-box promise stays intact even when the human was
  // out of the loop.
  autoSent: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("agent.draft_actions");
  const tCheck = useTranslations("agent.pre_send_check");
  const [editMode, setEditMode] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [isPending, startTransition] = useTransition();
  const [pendingSend, setPendingSend] = useState<null | { until: number }>(
    status === "sent_pending" ? { until: Date.now() + undoWindowSeconds * 1000 } : null
  );
  // engineer-39 — pre-send fact-checker modal. Open when the server
  // action throws PreSendCheckFailedError; warnings are the items the
  // fact-checker flagged. Closing dismisses the send entirely; "Send
  // anyway" re-calls the action with skipPreSendCheck.
  const [preSendWarnings, setPreSendWarnings] = useState<PreSendWarning[] | null>(
    null
  );

  const canSend =
    action === "draft_reply" &&
    (status === "pending" || status === "edited") &&
    body.trim().length > 0 &&
    initialTo.length > 0;

  const performSend = (skipPreSendCheck: boolean) => {
    startTransition(async () => {
      try {
        const { sendAt, undoWindowSeconds: ws } = await approveAgentDraftAction(
          draftId,
          { skipPreSendCheck }
        );
        setPreSendWarnings(null);
        setPendingSend({ until: new Date(sendAt).getTime() });
        toast.success(t("toast_sent", { n: ws }), { duration: ws * 1000 });
      } catch (err) {
        const parsed = tryParsePreSendError(err);
        if (parsed) {
          setPreSendWarnings(parsed.warnings);
          return;
        }
        toast.error(err instanceof Error ? err.message : t("toast_send_failed"));
      }
    });
  };

  const onSend = () => {
    if (!canSend) return;
    performSend(false);
  };

  const onUndo = () => {
    startTransition(async () => {
      try {
        await cancelPendingSendAction(draftId);
        setPendingSend(null);
        toast.success(t("toast_send_cancelled"));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toast_undo_failed"));
      }
    });
  };

  const onDismiss = () => {
    startTransition(async () => {
      try {
        await dismissAgentDraftAction(draftId);
        toast.success(t("toast_dismissed"));
        router.push("/app/inbox");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toast_dismiss_failed"));
      }
    });
  };

  const onSaveEdits = () => {
    startTransition(async () => {
      try {
        await saveDraftEditsAction({
          draftId,
          subject,
          body,
          to: initialTo,
          cc: initialCc,
        });
        setEditMode(false);
        toast.success(t("toast_draft_updated"));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toast_save_failed"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        The Draft form only carries content when the agent's proposed
        action is `draft_reply`. For `ask_clarifying` (Steadii needs the
        user to clarify something before drafting), every field would be
        empty — Ryuto observed the empty `Draft / To: ` block read as a
        bug. Skip the section entirely in that case; the agent's
        question lives in the ReasoningPanel above and the user can
        Dismiss with the button below.
      */}
      {action === "draft_reply" ? (
        <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          <div className="border-b border-[hsl(var(--border))] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("header_draft")}
          </div>
          <div className="px-4 py-3">
            <div className="text-small text-[hsl(var(--muted-foreground))]">
              {t("to")} <span className="text-[hsl(var(--foreground))]">{initialTo.join(", ")}</span>
            </div>
            {initialCc.length > 0 ? (
              <div className="text-small text-[hsl(var(--muted-foreground))]">
                {t("cc")} <span className="text-[hsl(var(--foreground))]">{initialCc.join(", ")}</span>
              </div>
            ) : null}
            {editMode ? (
              <>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-2 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-body focus:border-[hsl(var(--ring))] focus:outline-none"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="mt-2 w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-[hsl(var(--ring))] focus:outline-none"
                />
              </>
            ) : (
              <>
                <div className="mt-2 text-body font-medium text-[hsl(var(--foreground))]">
                  {subject}
                </div>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-small leading-relaxed text-[hsl(var(--foreground))]">
                  {body}
                </pre>
              </>
            )}
          </div>
        </section>
      ) : null}

      {preSendWarnings ? (
        <PreSendWarningModal
          warnings={preSendWarnings}
          onSendAnyway={() => performSend(true)}
          onCancel={() => setPreSendWarnings(null)}
          isPending={isPending}
          tCheck={tCheck}
        />
      ) : null}

      {status === "sent" ? (
        <SentBanner sentAt={sentAt} autoSent={autoSent} />
      ) : pendingSend ? (
        <UndoBar
          until={pendingSend.until}
          onUndo={onUndo}
          onTimeout={() => {
            setPendingSend(null);
            router.refresh();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {editMode ? (
            <>
              <button
                type="button"
                onClick={onSaveEdits}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
              >
                <Check size={14} strokeWidth={2} />
                {t("save_edits")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditMode(false);
                  setSubject(initialSubject);
                  setBody(initialBody);
                }}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
              >
                {t("cancel")}
              </button>
            </>
          ) : (
            <>
              {action === "draft_reply" ? (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend || isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
                >
                  <Check size={14} strokeWidth={2} />
                  {t("send")}
                </button>
              ) : null}
              {action === "draft_reply" ? (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                  {t("edit")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onDismiss}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                <X size={14} strokeWidth={1.75} />
                {t("dismiss")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UndoBar({
  until,
  onUndo,
  onTimeout,
}: {
  until: number;
  onUndo: () => void;
  onTimeout: () => void;
}) {
  const t = useTranslations("agent.draft_actions");
  const [remaining, setRemaining] = useState(
    Math.max(0, Math.ceil((until - Date.now()) / 1000))
  );
  const firedRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onTimeout();
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [until, onTimeout]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.06)] px-4 py-2.5 text-small">
      <span className="text-[hsl(var(--foreground))]">
        {t("sent_dispatching", { n: remaining })}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        {t("undo")}
      </button>
    </div>
  );
}

// Steady-state banner shown after the cron drains the send_queue and flips
// agent_drafts.status to 'sent'. Replaces the action button row entirely
// so the user sees a clean "this is done" affordance instead of stale
// Send/Edit/Dismiss buttons. Timestamp uses the user's local locale via
// toLocaleString — no need to pre-format on the server.
function SentBanner({
  sentAt,
  autoSent,
}: {
  sentAt: Date | null;
  autoSent: boolean;
}) {
  const t = useTranslations("agent.draft_actions");
  const label = sentAt
    ? new Date(sentAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  // Auto-sent drafts get an explicit "Sent automatically" framing — the
  // glass-box promise requires the user immediately know which sends
  // went out without their Send click. Same green palette so it still
  // reads as success, just with the autonomy callout.
  const headline = autoSent ? t("sent_automatically") : t("sent");
  return (
    <div className="flex items-center gap-2 rounded-md border border-[hsl(142_76%_36%/0.3)] bg-[hsl(142_76%_36%/0.06)] px-4 py-2.5 text-small">
      <CheckCircle2
        size={16}
        strokeWidth={1.75}
        className="shrink-0 text-[hsl(142_76%_36%)]"
      />
      <span className="text-[hsl(var(--foreground))]">
        {headline}
        {label ? (
          <>
            {" · "}
            <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}

// Keep Archive icon referenced so tree-shaking doesn't strip the import
// when the action set expands (cheap future-proof).
void Archive;

// engineer-39 — pre-send fact-checker modal. Backdrop + centered card.
// Two affordances: "Send anyway" (re-call the action with
// skipPreSendCheck) or "Edit draft" (cancel — closes the modal so the
// user can edit). Bare-bones styling since the rest of the app doesn't
// have a shadcn Dialog primitive yet; matches the look of the
// inline-role-picker which uses similar surface tokens.
function PreSendWarningModal({
  warnings,
  onSendAnyway,
  onCancel,
  isPending,
  tCheck,
}: {
  warnings: PreSendWarning[];
  onSendAnyway: () => void;
  onCancel: () => void;
  isPending: boolean;
  tCheck: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-send-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-[hsl(38_92%_40%)]"
          />
          <div className="min-w-0">
            <h2
              id="pre-send-warning-title"
              className="text-body font-semibold text-[hsl(var(--foreground))]"
            >
              {tCheck("modal_title")}
            </h2>
            <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
              {tCheck("modal_body")}
            </p>
          </div>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {warnings.map((w, i) => (
            <li
              key={i}
              className="rounded-md border border-[hsl(38_92%_40%/0.3)] bg-[hsl(38_92%_50%/0.06)] px-3 py-2 text-small"
            >
              <div className="font-medium text-[hsl(var(--foreground))]">
                &ldquo;{w.phrase}&rdquo;
              </div>
              <div className="mt-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
                {w.why}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {tCheck("cancel")}
          </button>
          <button
            type="button"
            onClick={onSendAnyway}
            disabled={isPending}
            className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
          >
            {tCheck("send_anyway")}
          </button>
        </div>
      </div>
    </div>
  );
}
