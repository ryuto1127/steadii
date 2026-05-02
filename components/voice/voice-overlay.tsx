"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useVoiceInput,
  type VoiceTriggerKey,
} from "@/components/chat/use-voice-input";
import { useVoiceApp } from "./voice-app-provider";

// Cmd+K-style summonable chat overlay. Mounts when overlayOpen is true.
//
// Close triggers:
//   - Caps Lock tap (canonical, handled in VoiceAppProvider's keyup branch)
//   - ESC key
//   - Click outside the card
//
// Submit:
//   - Empty: no-op
//   - Non-empty: POST /api/chat with content; render the response inline
//     below the input. Overlay stays open so the user can continue or close.
//   - Phase 1 hold-to-talk works inside the overlay's input (data-voice-composer
//     marker on the form makes the global handler stand down).
export function VoiceOverlay() {
  const tVoice = useTranslations("voice");
  const t = useTranslations("chat_input");
  const tOverlay = useTranslations("voice_overlay_extra");
  const router = useRouter();
  const { closeOverlay, effectiveKey } = useVoiceApp();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<
    Array<{ user: string; assistant: string }>
  >([]);
  const [voiceFlashKey, setVoiceFlashKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const voice = useVoiceInput({
    triggerKey: effectiveKey as VoiceTriggerKey,
    containerRef: formRef,
    chatId: pendingChatId,
    onResult: (cleaned) => {
      setInput((prev) => {
        const sep = prev.length > 0 && !/\s$/.test(prev) ? " " : "";
        return `${prev}${sep}${cleaned}`;
      });
      setVoiceFlashKey((k) => k + 1);
      window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      });
    },
    onError: (kind) => {
      if (kind === "mic_denied") toast.error(tVoice("error_mic_denied"));
      else if (kind === "transcribe_failed")
        toast.error(tVoice("error_transcribe_failed"));
      else if (kind === "cleanup_failed")
        toast(tVoice("warning_cleanup_skipped"));
      else if (kind === "rate_limited")
        toast.error(tVoice("error_rate_limited"));
    },
  });
  const voiceListening = voice.state === "listening";
  const voiceProcessing = voice.state === "processing";
  const voiceActive = voiceListening || voiceProcessing;

  // Listen for chat-routed global-voice results: the provider dispatches
  // 'steadii:open-chat-in-overlay' when the agent returns kind:"chat", with
  // the user message + assistant message already rendered. We seed the
  // exchanges array so the user sees the result immediately.
  useEffect(() => {
    const onChatResult = (e: Event) => {
      const detail = (e as CustomEvent<{
        chatId: string;
        userMessage: string;
        assistantMessage: string;
        needsConfirmation: boolean;
      }>).detail;
      if (!detail) return;
      setPendingChatId(detail.chatId);
      setExchanges([
        { user: detail.userMessage, assistant: detail.assistantMessage },
      ]);
      if (detail.needsConfirmation) {
        // Defer to the full chat view where the inline confirmation card
        // lives. Toast tells the user we're handing off.
        toast(tVoice("confirmation_handoff"));
        // small delay so the toast renders before the route change
        window.setTimeout(() => {
          closeOverlay();
          router.push(`/app/chat/${detail.chatId}`);
        }, 600);
      }
    };
    window.addEventListener(
      "steadii:open-chat-in-overlay",
      onChatResult as EventListener
    );
    return () =>
      window.removeEventListener(
        "steadii:open-chat-in-overlay",
        onChatResult as EventListener
      );
  }, [closeOverlay, router, tVoice]);

  // Auto-focus the input on mount.
  useEffect(() => {
    const el = textareaRef.current;
    if (el) el.focus();
  }, []);

  // ESC closes (canonical close is Caps Lock re-tap, handled by provider).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeOverlay();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOverlay]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        closeOverlay();
      }
    },
    [closeOverlay]
  );

  const submit = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      const content = input.trim();
      if (!content || submitting) return;
      setSubmitting(true);
      try {
        // /api/voice/agent both creates the chat and runs the orchestrator.
        // Reusing it for typed submits keeps the operation/chat shape detection
        // unified — typed "add MAT223" should toast just like spoken does.
        const resp = await fetch("/api/voice/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!resp.ok) {
          toast.error(tVoice("error_agent_failed"));
          return;
        }
        const json = (await resp.json()) as
          | {
              kind: "operation";
              summary: string;
              executed: Array<{ tool: string; ok: boolean }>;
            }
          | {
              kind: "chat";
              chatId: string;
              userMessage: string;
              assistantMessage: string;
              needsConfirmation?: boolean;
            };
        if (json.kind === "operation") {
          const allOk = json.executed.every((e) => e.ok);
          if (allOk) toast.success(json.summary);
          else toast.error(tVoice("error_operation_partial"));
          // Operation toasted; close so user sees their page (not the overlay).
          closeOverlay();
          setInput("");
        } else {
          setPendingChatId(json.chatId);
          setExchanges((prev) => [
            ...prev,
            { user: json.userMessage, assistant: json.assistantMessage },
          ]);
          setInput("");
          if (json.needsConfirmation) {
            toast(tVoice("confirmation_handoff"));
            window.setTimeout(() => {
              closeOverlay();
              router.push(`/app/chat/${json.chatId}`);
            }, 600);
          }
        }
      } catch {
        toast.error(tVoice("error_agent_failed"));
      } finally {
        setSubmitting(false);
      }
    },
    [closeOverlay, input, router, submitting, tVoice]
  );

  const canSubmit = input.trim().length > 0 && !submitting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tVoice("overlay_label")}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 px-4 pb-8 pt-[18vh] backdrop-blur-sm steadii-overlay-backdrop"
      onMouseDown={onBackdropClick}
    >
      <div
        ref={cardRef}
        className="steadii-overlay-card relative w-full max-w-2xl rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.30)]"
      >
        {voiceActive ? (
          <span
            aria-hidden
            className={cn(
              "steadii-voice-listening pointer-events-none absolute -inset-2 rounded-2xl",
              voiceProcessing && "steadii-voice-processing"
            )}
          />
        ) : null}
        <form
          ref={formRef}
          onSubmit={submit}
          data-voice-composer="true"
          className={cn(
            "relative flex w-full items-end gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2 transition-default",
            voiceActive && "steadii-voice-active-ring"
          )}
        >
          <label htmlFor="voice-overlay-textarea" className="sr-only">
            {t("placeholder")}
          </label>
          <div className="relative flex min-h-11 flex-1 items-center">
            <textarea
              key={voiceFlashKey}
              ref={textareaRef}
              id="voice-overlay-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                voiceProcessing
                  ? tVoice("processing_placeholder")
                  : voiceListening
                    ? tVoice("listening_placeholder")
                    : tVoice("overlay_placeholder")
              }
              rows={1}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              className={cn(
                "block w-full resize-none bg-transparent px-3 text-[15px] leading-[1.4] text-[hsl(var(--foreground))] focus:outline-none",
                voiceActive
                  ? "placeholder:italic placeholder:text-[hsl(var(--muted-foreground))]"
                  : "placeholder:text-[hsl(var(--muted-foreground))]",
                voiceFlashKey > 0 && "steadii-voice-text-fade-in"
              )}
            />
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition-default",
              canSubmit
                ? "bg-[hsl(var(--foreground))] text-[hsl(var(--surface))] hover:opacity-90"
                : "bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))] opacity-60"
            )}
            aria-label={tOverlay("send_aria")}
          >
            <SendHorizontal size={18} strokeWidth={2} />
          </button>
        </form>

        {exchanges.length > 0 ? (
          <div className="mt-3 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
            {exchanges.map((ex, i) => (
              <div key={i} className="space-y-1.5">
                <div className="rounded-lg bg-[hsl(var(--surface-raised))] px-3 py-2 text-[14px] text-[hsl(var(--foreground))]">
                  {ex.user}
                </div>
                <div className="rounded-lg px-3 py-2 text-[14px] text-[hsl(var(--foreground))]">
                  {ex.assistant || (
                    <span className="text-[hsl(var(--muted-foreground))]">…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <p className="mt-3 px-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {effectiveKey === "alt_right"
            ? tVoice("overlay_hint_alt")
            : tVoice("overlay_hint_caps")}
        </p>
      </div>
    </div>
  );
}
