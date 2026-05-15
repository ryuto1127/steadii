"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import type { DraftConfidence } from "@/lib/chat/draft-detect";

// engineer-63 — action bar rendered next to a draft-shaped fenced code block.
// "Confident" drafts (both greeting + closing markers) get full Send + Edit;
// "maybe" drafts get a smaller affordance + tooltip. Send opens a confirmation
// modal showing parsed to/subject/body; Edit replaces the code block with an
// inline textarea. Both paths talk to /api/chat/draft-send and
// /api/chat/draft-edit respectively.

export type DraftReplyTarget = {
  // Resolved server-side from messages.tool_calls → email_get_body /
  // email_get_new_content_only inboxItemId. Null when the assistant turn
  // had no email body fetch (rare; we render the missing-target hint).
  inboxItemId: string | null;
  // Hydrated server-side when inboxItemId is known. Shown in the confirm
  // modal; null when unresolvable (offline render etc.).
  to: string | null;
  subject: string | null;
};

export type DraftActionBarProps = {
  chatId: string;
  messageId: string;
  blockIndex: number;
  body: string;
  confidence: DraftConfidence;
  replyTarget: DraftReplyTarget;
  // Called by parent (MarkdownMessage) when the user saves an edit — parent
  // owns the markdown re-render, since we cannot mutate it in place.
  onEditSaved?: (newBody: string) => void;
};

type SentState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "sending" }
  | { kind: "sent"; at: Date }
  | { kind: "error"; message: string };

export function DraftActionBar(props: DraftActionBarProps) {
  const t = useTranslations("chat.draft_actions");
  const [state, setState] = useState<SentState>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(props.body);

  // Keep local draftBody in sync if the parent re-renders with a new body
  // (e.g. after the agent re-streamed). Without this, opening + cancelling
  // edit twice on a re-streamed message would show stale text.
  useEffect(() => {
    setDraftBody(props.body);
  }, [props.body]);

  const canSend = props.replyTarget.inboxItemId !== null;

  if (state.kind === "sent") {
    return <SentBanner at={state.at} />;
  }

  if (editing) {
    return (
      <EditPanel
        chatId={props.chatId}
        messageId={props.messageId}
        blockIndex={props.blockIndex}
        body={draftBody}
        onChange={setDraftBody}
        onCancel={() => {
          setDraftBody(props.body);
          setEditing(false);
        }}
        onSaved={(newBody) => {
          setDraftBody(newBody);
          setEditing(false);
          props.onEditSaved?.(newBody);
        }}
      />
    );
  }

  if (state.kind === "confirming") {
    return (
      <ConfirmModal
        to={props.replyTarget.to}
        subject={props.replyTarget.subject}
        body={draftBody}
        onCancel={() => setState({ kind: "idle" })}
        onSend={async () => {
          if (!props.replyTarget.inboxItemId) return;
          setState({ kind: "sending" });
          try {
            const res = await fetch("/api/chat/draft-send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId: props.chatId,
                messageId: props.messageId,
                replyToInboxItemId: props.replyTarget.inboxItemId,
                body: draftBody,
              }),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              const msg =
                (errBody as { error?: string })?.error ?? t("sent_error");
              setState({ kind: "error", message: msg });
              toast.error(msg);
              return;
            }
            setState({ kind: "sent", at: new Date() });
          } catch {
            setState({ kind: "error", message: t("sent_error") });
            toast.error(t("sent_error"));
          }
        }}
      />
    );
  }

  // idle or error (errors fall through to the action bar — user can retry)
  const isMaybe = props.confidence === "maybe";
  const sendAria = props.replyTarget.to
    ? t("send_aria", { recipient: props.replyTarget.to })
    : t("send");

  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2",
        isMaybe && "opacity-80"
      )}
      title={isMaybe ? t("looks_like_draft_tooltip") : undefined}
    >
      <button
        type="button"
        disabled={!canSend || state.kind === "sending"}
        onClick={() => setState({ kind: "confirming" })}
        aria-label={sendAria}
        title={!canSend ? t("missing_reply_target") : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-small font-medium transition-hover",
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
          isMaybe && "px-2 py-1 text-[12px]"
        )}
      >
        <Send size={isMaybe ? 11 : 13} strokeWidth={1.75} />
        {t("send")}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t("edit_aria")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]",
          isMaybe && "px-2 py-1 text-[12px]"
        )}
      >
        <Pencil size={isMaybe ? 11 : 13} strokeWidth={1.5} />
        {t("edit")}
      </button>
      {state.kind === "error" ? (
        <span
          className="text-[12px] text-[hsl(var(--destructive))]"
          role="alert"
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

function SentBanner({ at }: { at: Date }) {
  const t = useTranslations("chat.draft_actions");
  const locale = useLocale();
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--surface-raised))] px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))]"
    >
      <Check size={13} strokeWidth={2} className="text-[hsl(var(--primary))]" />
      {t("sent_success", { time })}
    </div>
  );
}

function EditPanel({
  chatId,
  messageId,
  blockIndex,
  body,
  onChange,
  onCancel,
  onSaved,
}: {
  chatId: string;
  messageId: string;
  blockIndex: number;
  body: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSaved: (newBody: string) => void;
}) {
  const t = useTranslations("chat.draft_actions");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on mount + place caret at end so the user can keep
  // typing without a click.
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/draft-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          messageId,
          blockIndex,
          newBody: body,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setError(
          (errBody as { error?: string })?.error ?? t("sent_error")
        );
        return;
      }
      onSaved(body);
    } catch {
      setError(t("sent_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("edit_textarea_label")}
        rows={Math.min(20, Math.max(6, body.split("\n").length + 1))}
        className="block w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 font-mono text-[13px] leading-relaxed text-[hsl(var(--foreground))] focus:border-[hsl(var(--ring))] focus:outline-none focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
        disabled={saving}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-40"
        >
          <Check size={13} strokeWidth={1.75} />
          {t("save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <X size={13} strokeWidth={1.5} />
          {t("cancel")}
        </button>
        {error ? (
          <span className="text-[12px] text-[hsl(var(--destructive))]" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmModal({
  to,
  subject,
  body,
  onCancel,
  onSend,
}: {
  to: string | null;
  subject: string | null;
  body: string;
  onCancel: () => void;
  onSend: () => void;
}) {
  const t = useTranslations("chat.draft_actions");
  const dialogRef = useRef<HTMLDivElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap — Esc closes, Tab cycles within the dialog. Send button
  // auto-focuses on open so Enter immediately confirms.
  useEffect(() => {
    sendBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-lg"
      >
        <h2
          id="draft-confirm-title"
          className="text-h3 font-medium text-[hsl(var(--foreground))]"
        >
          {t("confirm_title")}
        </h2>
        <dl className="mt-3 space-y-1.5 text-small">
          <ConfirmRow label={t("confirm_to")} value={to ?? "—"} />
          <ConfirmRow label={t("confirm_subject")} value={subject ?? "—"} />
        </dl>
        <div className="mt-3">
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("confirm_body")}
          </p>
          <pre className="mt-1 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 font-mono text-[12px] leading-relaxed text-[hsl(var(--foreground))]">
            {body}
          </pre>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            ref={sendBtnRef}
            onClick={onSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            <Send size={13} strokeWidth={1.75} />
            {t("confirm_send_button")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
        {value}
      </dd>
    </div>
  );
}
