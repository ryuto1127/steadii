"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Archive, Clock3, X } from "lucide-react";
import {
  approveAgentDraftAction,
  cancelPendingSendAction,
  dismissAgentDraftAction,
  snoozeAgentDraftAction,
  saveDraftEditsAction,
} from "@/lib/agent/email/draft-actions";

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
}: {
  draftId: string;
  status: Status;
  action: "draft_reply" | "archive" | "snooze" | "no_op" | "ask_clarifying" | "paused";
  initialSubject: string;
  initialBody: string;
  initialTo: string[];
  initialCc: string[];
  undoWindowSeconds: number;
}) {
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [isPending, startTransition] = useTransition();
  const [pendingSend, setPendingSend] = useState<null | { until: number }>(
    status === "sent_pending" ? { until: Date.now() + undoWindowSeconds * 1000 } : null
  );

  const canSend =
    action === "draft_reply" &&
    (status === "pending" || status === "edited") &&
    body.trim().length > 0 &&
    initialTo.length > 0;

  const onSend = () => {
    if (!canSend) return;
    startTransition(async () => {
      try {
        const { sendAt, undoWindowSeconds: ws } =
          await approveAgentDraftAction(draftId);
        setPendingSend({ until: new Date(sendAt).getTime() });
        toast.success(`Sent · undo in ${ws}s`, { duration: ws * 1000 });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Send failed");
      }
    });
  };

  const onUndo = () => {
    startTransition(async () => {
      try {
        await cancelPendingSendAction(draftId);
        setPendingSend(null);
        toast.success("Send cancelled");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Undo failed");
      }
    });
  };

  const onDismiss = () => {
    startTransition(async () => {
      try {
        await dismissAgentDraftAction(draftId);
        toast.success("Dismissed");
        router.push("/app/inbox");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Dismiss failed");
      }
    });
  };

  const onSnooze = (hours: number) => {
    startTransition(async () => {
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      try {
        await snoozeAgentDraftAction(draftId, until.toISOString());
        toast.success(`Snoozed ${hours}h`);
        router.push("/app/inbox");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Snooze failed");
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
        toast.success("Draft updated");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
        <div className="border-b border-[hsl(var(--border))] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Draft
        </div>
        <div className="px-4 py-3">
          <div className="text-small text-[hsl(var(--muted-foreground))]">
            To: <span className="text-[hsl(var(--foreground))]">{initialTo.join(", ")}</span>
          </div>
          {initialCc.length > 0 ? (
            <div className="text-small text-[hsl(var(--muted-foreground))]">
              Cc: <span className="text-[hsl(var(--foreground))]">{initialCc.join(", ")}</span>
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

      {pendingSend ? (
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
                Save edits
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
                Cancel
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
                  Send
                </button>
              ) : null}
              {action === "draft_reply" ? (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                  Edit
                </button>
              ) : null}
              <SnoozeMenu onSnooze={onSnooze} disabled={isPending} />
              <button
                type="button"
                onClick={onDismiss}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                <X size={14} strokeWidth={1.75} />
                Dismiss
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
        Sent — dispatches in <span className="font-mono tabular-nums">{remaining}s</span>.
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        Undo
      </button>
    </div>
  );
}

function SnoozeMenu({
  onSnooze,
  disabled,
}: {
  onSnooze: (hours: number) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
      >
        <Clock3 size={14} strokeWidth={1.75} />
        Snooze
      </button>
      {open ? (
        <div
          className="absolute left-0 z-10 mt-1 min-w-[140px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          {[
            { label: "1 hour", h: 1 },
            { label: "Tomorrow", h: 24 },
            { label: "Next week", h: 24 * 7 },
          ].map((opt) => (
            <button
              key={opt.h}
              type="button"
              onClick={() => {
                setOpen(false);
                onSnooze(opt.h);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Keep Archive icon referenced so tree-shaking doesn't strip the import
// when the action set expands (cheap future-proof).
void Archive;
