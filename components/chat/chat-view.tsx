"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Paperclip,
  ArrowUp,
  FileText as FileTextIcon,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
// engineer-47 — chat-driven mistake-save dialog removed entirely. The pill
// was dropped in PR #210; the dialog + /api/mistakes/save + the
// `saveMistakeNote` helper are gone too. The new user_facts feature lives
// at /app/settings/facts + the save_user_fact chat tool, not in chat UI.
// Handwritten-OCR + class-detail mistake_notes paths remain.
import { MarkdownMessage } from "./markdown-message";
import { type DraftReplyTarget } from "./draft-action-bar";
import { type ToolCallStatus } from "./tool-call-card";
import { ToolCallSummary } from "./tool-call-summary";
import { parseProposedActions } from "./proposed-actions";
import { ActionPill } from "@/components/ui/action-pill";
import { cn } from "@/lib/utils/cn";
import { reportDetectedTimezone } from "@/lib/utils/report-timezone";
import {
  deleteChatAction,
  renameChatAction,
} from "@/lib/agent/chat-actions";
import { useVoiceInput, type VoiceTriggerKey } from "./use-voice-input";
import { VoiceChoice } from "./voice-choice";

type Attachment = {
  id: string;
  kind: "image" | "pdf";
  url: string;
  filename: string | null;
};

type ToolEvent = {
  id: string; // toolCallId
  toolName: string;
  status: ToolCallStatus;
  args?: unknown;
  result?: unknown;
  pendingId?: string;
};

type TurnItem =
  | { kind: "narration"; text: string }
  | { kind: "tool"; event: ToolEvent };

// engineer-58 — mirrors messages.status. Only assistant rows ever reach a
// non-'done' value in practice; user / tool rows are written once and stay
// 'done'. Optional in the type because legacy callers / partial updates
// don't always carry it.
type MessageStatus =
  | "pending"
  | "processing"
  | "done"
  | "error"
  | "cancelled";

type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  status?: MessageStatus;
  items?: TurnItem[];
  attachments: Attachment[];
};

export function ChatView({
  chatId,
  initialTitle,
  initialMessages,
  initialReplyTargets = {},
  blobConfigured = true,
  autoStream = false,
  voiceTriggerKey = "caps_lock",
  clarificationBanner = null,
}: {
  chatId: string;
  initialTitle: string | null;
  initialMessages: Message[];
  // engineer-63 — server-resolved reply target per assistant message id.
  // Drives the Send button's destination + the confirm modal's preview.
  initialReplyTargets?: Record<string, DraftReplyTarget>;
  blobConfigured?: boolean;
  autoStream?: boolean;
  voiceTriggerKey?: VoiceTriggerKey;
  // engineer-46 — set when the chat was opened from a Type E
  // clarifying queue card. Renders a banner above the chat header
  // linking back to /app so the student remembers which card they're
  // resolving. `resolved=true` flips the banner copy after the
  // resolve_clarification tool fires.
  clarificationBanner?: {
    title: string;
    resolved: boolean;
  } | null;
}) {
  const t = useTranslations();
  const tVoice = useTranslations("voice");
  const tChat = useTranslations("chat_view");
  const tChatV2 = useTranslations("chat_view_v2");
  const [title, setTitle] = useState<string>(initialTitle ?? "");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  // Per-message-id set of "consumed" proposed-action pill rows. Once the
  // user clicks any pill on a message, the pills hide so they can't fire
  // twice and the chat reads as a normal continuation.
  const [consumedActions, setConsumedActions] = useState<Set<string>>(
    () => new Set()
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{
    filename: string;
    kind: "image" | "pdf";
  } | null>(null);
  const [, startTransition] = useTransition();
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const didAutoStream = useRef(false);
  const sendingRef = useRef(false);
  const composerRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [voiceFlashKey, setVoiceFlashKey] = useState(0);

  // Auto-focus the composer on mount + whenever streaming ends so the user
  // doesn't have to click into the textarea on every conversational turn.
  // The textarea is `disabled` while streaming; React enables it on the
  // false transition, but focus has to be re-acquired explicitly.
  useEffect(() => {
    if (streaming) return;
    const el = textareaRef.current;
    if (!el) return;
    // Skip when another input/textarea/contenteditable already has focus —
    // user may be typing somewhere else (search, etc.); don't steal.
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        (active as HTMLElement).isContentEditable)
    ) {
      return;
    }
    el.focus();
  }, [streaming]);

  const voice = useVoiceInput({
    triggerKey: voiceTriggerKey,
    containerRef: composerRef,
    chatId,
    onResult: (cleaned) => {
      setInput((prev) => {
        const sep = prev.length > 0 && !/\s$/.test(prev) ? " " : "";
        return `${prev}${sep}${cleaned}`;
      });
      setVoiceFlashKey((k) => k + 1);
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

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Auto-trigger the stream when the URL has ?stream=1 (e.g., user hit send
  // from the Home input and was routed here with a fresh user message that
  // already exists in the DB).
  useEffect(() => {
    if (!autoStream || didAutoStream.current) return;
    didAutoStream.current = true;

    // Strip ?stream=1 from the URL the moment we consume it. The ref guard
    // above only protects against double-fires within a single React tree;
    // it does NOT survive Cmd+R, because a fresh page load gets a fresh
    // ref. Without this scrub, every reload would replay runStream() and
    // stack a duplicate assistant response in the DB (and burn an /api/chat
    // call). Use history.replaceState rather than router.replace so we
    // don't trigger a server-component re-fetch of the whole chat.
    window.history.replaceState(null, "", `/app/chat/${chatId}`);

    // If the chat already has a processing assistant message (e.g. landed
    // from inbox ?stream=1 on an in-flight email reply), skip the new run
    // and let the resume-poll effect drive the existing one to completion.
    // Otherwise we'd stack two concurrent generations on the same chat.
    if (inFlightAssistantId) return;

    void runStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStream]);

  // engineer-58 — tab-close resilience. If any assistant row is still
  // status='processing' on mount (or after a SSE network failure mid-
  // stream), drive its completion by polling /api/chat/messages/[id]/status
  // every 2s. The orchestrator keeps running on the server via after() +
  // maxDuration=300; this loop is the client-side resume.
  const inFlightAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.status === "processing") return m.id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!inFlightAssistantId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // Flip the streaming flag so the textarea stays disabled and the
    // in-progress cursor renders while we resume.
    setStreaming(true);

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/chat/messages/${inFlightAssistantId}/status`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          // 404 (row deleted) or 401 — give up on this run.
          setStreaming(false);
          return;
        }
        const data = (await res.json()) as PollStatusResponse;
        setMessages((prev) =>
          prev.map((m) => (m.id === data.id ? rehydrateFromPoll(m, data) : m))
        );
        if (data.status === "processing") {
          timeoutId = setTimeout(tick, 2000);
        } else {
          // Terminal status reached. Drop streaming, then refresh the
          // page server-side so any tool messages / titles that landed
          // between polls propagate into the rest of the UI (sidebar,
          // chats list, etc.).
          setStreaming(false);
          startTransition(() => router.refresh());
        }
      } catch {
        // Transient network error — back off and try again. Don't drop
        // the streaming flag; the run may still be in progress server-
        // side and we'll catch up on the next tick.
        if (!cancelled) timeoutId = setTimeout(tick, 4000);
      }
    };

    void tick();

    // Tab-focus return: when the user comes back to the tab, poll
    // immediately instead of waiting up to 2s for the next scheduled
    // tick. This is the moment they're most likely to be watching the
    // UI for progress.
    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-runs when the in-flight target changes. Intentionally omit
    // `streaming` and `router` — the closure reads what it needs at
    // setup time and we don't want toggle-on-streaming to abort the
    // polling we just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlightAssistantId]);

  async function runStream() {
    setStreamError(null);
    setStreaming(true);
    const assistantTempId = "assistant-" + Date.now();
    setMessages((m) => {
      // Defensive dedup: if the trailing message is already an empty
      // streaming-temp assistant row (a stray runStream call landed here
      // before the previous one resolved), reuse it instead of stacking
      // two empty bubbles. The "double-render" report 2026-04-30 traced
      // to a path where this skip wasn't enforced.
      const last = m[m.length - 1];
      if (
        last &&
        last.role === "assistant" &&
        last.id.startsWith("assistant-") &&
        !last.content &&
        !last.items?.length
      ) {
        return m;
      }
      return [
        ...m,
        { id: assistantTempId, role: "assistant", content: "", attachments: [] },
      ];
    });
    try {
      const sse = await fetch(`/api/chat?chatId=${encodeURIComponent(chatId)}`, {
        headers: { Accept: "text/event-stream" },
      });
      if (!sse.body) throw new Error("no stream");
      const reader = sse.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let currentAssistantId = assistantTempId;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === "message_start" && payload.assistantMessageId) {
              currentAssistantId = payload.assistantMessageId;
              setMessages((m) => {
                // If the persisted ID is already in the list (e.g. an
                // earlier render seeded it from initialMessages), drop
                // the temp instead of renaming so we don't end up with
                // two rows holding the same id.
                const alreadyHas = m.some((x) => x.id === currentAssistantId);
                if (alreadyHas) {
                  return m.filter((x) => x.id !== assistantTempId);
                }
                return m.map((x) =>
                  x.id === assistantTempId
                    ? { ...x, id: currentAssistantId, status: "processing" }
                    : x
                );
              });
            } else if (payload.type === "text_delta") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? { ...x, content: x.content + payload.delta }
                    : x
                )
              );
            } else if (payload.type === "tool_call_started") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? flushNarrationAndAddTool(x, {
                        id: payload.toolCallId,
                        toolName: payload.toolName,
                        status: "running",
                        args: payload.args,
                      })
                    : x
                )
              );
            } else if (payload.type === "tool_call_result") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? updateToolStatus(x, payload.toolCallId, {
                        status: payload.ok ? "done" : "failed",
                        result: payload.result,
                      })
                    : x
                )
              );
            } else if (payload.type === "tool_call_pending") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? flushNarrationAndAddTool(x, {
                        id: payload.toolCallId,
                        toolName: payload.toolName,
                        status: "pending",
                        args: payload.args,
                        pendingId: payload.pendingId,
                      })
                    : x
                )
              );
            } else if (payload.type === "title") {
              if (typeof payload.title === "string" && payload.title.trim()) {
                setTitle(payload.title);
              }
            } else if (payload.type === "error") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? {
                        ...x,
                        role: "assistant",
                        status: "error" as const,
                        content:
                          x.content ||
                          `⚠ ${payload.message ?? "Something went wrong."}`,
                      }
                    : x
                )
              );
              setStreamError(
                payload.message ?? `Stream failed (${payload.code ?? "UNKNOWN"})`
              );
            } else if (
              payload.type === "message_end" ||
              payload.type === "done"
            ) {
              // engineer-58 — flip local status to 'done' so the resume-
              // poll effect doesn't pick this row up after the stream
              // finishes naturally. Orchestrator already wrote 'done' to
              // the DB at this point (or 'error' if OPENAI_FAILED — that
              // path emits the error event above which overrides this).
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId && x.status !== "error"
                    ? { ...x, status: "done" as const }
                    : x
                )
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Stream failed.");
    } finally {
      setStreaming(false);
      startTransition(() => router.refresh());
    }
  }

  async function confirmPending(pendingId: string, decision: "approve" | "deny") {
    const res = await fetch("/api/chat/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingId, decision }),
    });
    if (!res.ok) {
      setStreamError(`Confirmation failed: ${await res.text()}`);
      return;
    }
    // Apply the local update on a snapshot so we can reason about the
    // post-update state synchronously — needed to decide whether more
    // pendings remain (multi-delete batch) before resuming the stream.
    const next = messages.map((msg) => ({
      ...msg,
      items: msg.items?.map((it) =>
        it.kind === "tool" && it.event.pendingId === pendingId
          ? {
              ...it,
              event: {
                ...it.event,
                status: decision === "approve" ? ("done" as const) : ("denied" as const),
              },
            }
          : it
      ),
    }));
    setMessages(next);

    const stillPending = next.some((msg) =>
      msg.items?.some(
        (it) => it.kind === "tool" && it.event.status === "pending"
      )
    );
    // Multi-tool batches yield N pending rows at once — wait until the
    // user has resolved every one before the orchestrator resumes,
    // otherwise the second confirm fires a stream that loadHistory has
    // not yet been told about, and the agent reports phantom failures.
    if (stillPending) return;

    await runStream();
  }

  // Click handler for "Proposed actions" pills. Posts the action's label as
  // a user message — the LLM has the prior turn (including its own
  // proposed-actions block) in context and constructs the tool call from
  // there. Write tools still flow through pending_tool_calls confirmation,
  // so safety isn't bypassed; this is a typing shortcut, not a back door.
  async function runProposedAction(messageId: string, label: string) {
    if (sendingRef.current || streaming) return;
    if (consumedActions.has(messageId)) return;
    sendingRef.current = true;
    setConsumedActions((s) => {
      const next = new Set(s);
      next.add(messageId);
      return next;
    });
    const userMsg: Message = {
      id: "temp-" + Date.now(),
      role: "user",
      content: label,
      attachments: [],
    };
    setMessages((m) => [...m, userMsg]);
    try {
      const res = await fetch(`/api/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content: label }),
      });
      if (!res.ok) {
        setStreamError(tChat("set_stream_action_failed"));
        return;
      }
      const { messageId: persistedId } = (await res.json()) as {
        messageId: string;
      };
      setMessages((m) =>
        m.map((x) => (x.id === userMsg.id ? { ...x, id: persistedId } : x))
      );
      await runStream();
    } finally {
      sendingRef.current = false;
    }
  }

  async function send() {
    // Guard against double-submit: a rapid second Enter press can re-enter
    // `send` before React flushes the `setInput("")` from the first call,
    // so the closure's stale `input` would post the same text twice.
    if (sendingRef.current) return;
    if (!input.trim() && !attachment) return;
    sendingRef.current = true;
    const text = input.trim();
    const att = attachment;
    setInput("");
    setAttachment(null);
    reportDetectedTimezone();

    const userMsg: Message = {
      id: "temp-" + Date.now(),
      role: "user",
      content: text,
      attachments: att ? [att] : [],
    };
    setMessages((m) => [...m, userMsg]);

    try {
      const res = await fetch(`/api/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content: text }),
      });
      if (!res.ok) {
        setStreamError(tChat("set_stream_send_failed"));
        return;
      }
      const { messageId } = (await res.json()) as { messageId: string };
      setMessages((m) =>
        m.map((x) => (x.id === userMsg.id ? { ...x, id: messageId } : x))
      );

      await runStream();
    } finally {
      sendingRef.current = false;
    }
  }

  async function uploadFile(file: File) {
    setUploadError(null);
    const isPdf = file.type === "application/pdf";
    setUploading({
      filename: file.name,
      kind: isPdf ? "pdf" : "image",
    });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("chatId", chatId);
      const res = await fetch("/api/chat/attachments", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let friendly = tChat("upload_failed_http", { status: res.status });
        try {
          const body = await res.json();
          if (typeof body?.error === "string") friendly = body.error;
        } catch {
          // non-JSON response — fall through to HTTP code
        }
        setUploadError(friendly);
        return;
      }
      const body = (await res.json()) as { attachment: Attachment };
      setAttachment(body.attachment);
    } finally {
      setUploading(null);
    }
  }

  const hasAnyPending = messages.some((m) =>
    m.items?.some((it) => it.kind === "tool" && it.event.status === "pending")
  );

  return (
    <>
      {clarificationBanner ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[12px] text-[hsl(var(--muted-foreground))]">
          <span className="min-w-0 truncate">
            <span className="font-medium text-[hsl(var(--foreground))]">
              {clarificationBanner.resolved
                ? t("chat.clarification_banner.title_resolved")
                : t("chat.clarification_banner.title")}
            </span>
            <span className="ml-1 truncate">{clarificationBanner.title}</span>
          </span>
          <Link
            href="/app"
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("chat.clarification_banner.back")}
          </Link>
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border))] pb-3">
        <form action={renameChatAction} className="min-w-0 flex-1">
          <input type="hidden" name="id" value={chatId} />
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tChat("title_placeholder")}
            className="w-full bg-transparent text-h2 text-[hsl(var(--foreground))] focus:outline-none"
          />
        </form>
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            <Plus size={13} strokeWidth={1.5} />
            {tChat("new_chat")}
          </Link>
          <form action={deleteChatAction}>
            <input type="hidden" name="id" value={chatId} />
            <button
              type="submit"
              className="inline-flex h-9 items-center text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
            >
              {tChat("delete")}
            </button>
          </form>
        </div>
      </header>

    <div className="flex h-[calc(100dvh-12rem)] flex-col md:h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-5">
          {messages.map((m, idx) => {
            const isLastAssistant =
              m.role === "assistant" && idx === messages.length - 1;
            const showCursor = streaming && isLastAssistant && !hasAnyPending;
            const isUserMsg = m.role === "user";
            // Pull "Proposed actions:" out of assistant content so we can
            // render it as pills (Fix 6) instead of leaking the raw
            // [tool_name] markup. Falls through unchanged when the block
            // isn't present.
            const parsed =
              m.role === "assistant"
                ? parseProposedActions(m.content)
                : { body: m.content, actions: [] as { toolName: string; label: string }[] };
            const renderBody = parsed.body;
            const proposedActions =
              !consumedActions.has(m.id) && !m.id.startsWith("assistant-")
                ? parsed.actions
                : [];
            return (
              <li
                key={m.id}
                className={cn(
                  "flex",
                  isUserMsg ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    isUserMsg
                      ? "max-w-[80%] rounded-md bg-[hsl(var(--surface-raised))] px-3 py-2 text-body"
                      : "max-w-[85%] text-body"
                  )}
                >
                  {m.attachments.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {m.attachments.map((a) =>
                        a.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={a.id}
                            src={a.url}
                            alt={a.filename ?? "attachment"}
                            className="max-h-[200px] max-w-[200px] rounded-sm border border-[hsl(var(--border))]"
                          />
                        ) : (
                          <a
                            key={a.id}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-sm border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-small"
                          >
                            <FileTextIcon
                              size={12}
                              strokeWidth={1.5}
                              className="text-[hsl(var(--muted-foreground))]"
                            />
                            {a.filename ?? "PDF"}
                          </a>
                        )
                      )}
                    </div>
                  )}
                  {m.role === "assistant" && m.items && m.items.length > 0 && (
                    <div className="mb-2">
                      <ToolCallSummary
                        items={m.items}
                        isStreaming={streaming && isLastAssistant}
                        onConfirmPending={confirmPending}
                      />
                    </div>
                  )}
                  {renderBody ? (
                    m.role === "assistant" ? (
                      <div className={cn(showCursor && "streaming-cursor")}>
                        <MarkdownMessage
                          content={renderBody}
                          draftContext={
                            // Only render Send/Edit on persisted assistant
                            // rows — temp streaming ids ("assistant-…")
                            // change on message_start, and the reply target
                            // is keyed by the persisted id.
                            !m.id.startsWith("assistant-") &&
                            initialReplyTargets[m.id]
                              ? {
                                  chatId,
                                  messageId: m.id,
                                  replyTarget: initialReplyTargets[m.id],
                                }
                              : undefined
                          }
                        />
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{renderBody}</span>
                    )
                  ) : m.role === "assistant" && streaming && !hasAnyPending ? (
                    <span className="streaming-cursor" aria-label={tChat("thinking_aria")} />
                  ) : m.role === "assistant" && !m.items?.length ? (
                    <span className="text-[hsl(var(--muted-foreground))]">…</span>
                  ) : null}
                  {m.role === "assistant" &&
                    m.content &&
                    !m.id.startsWith("assistant-") && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {proposedActions.map((a, i) => (
                          <ActionPill
                            key={`${m.id}-action-${i}`}
                            tone="primary"
                            disabled={streaming}
                            onClick={() => runProposedAction(m.id, a.label)}
                          >
                            {a.label}
                          </ActionPill>
                        ))}
                      </div>
                    )}
                </div>
              </li>
            );
          })}
        </ul>

        <div ref={scrollAnchor} />
      </div>

      <div className="border-t border-[hsl(var(--border))] py-3">
        {!blobConfigured && (
          <div className="mb-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
            {tChat("blob_disabled_prefix")}
            <code className="mx-1 font-mono text-[hsl(var(--foreground))]">
              {tChatV2("blob_token_const")}
            </code>
            {tChat("blob_disabled_suffix")}
          </div>
        )}
        {uploadError && (
          <InlineAlert
            tone="destructive"
            onDismiss={() => setUploadError(null)}
            dismissLabel={t("chat.dismiss")}
          >
            {uploadError}
          </InlineAlert>
        )}
        {streamError && (
          <InlineAlert
            tone="destructive"
            onDismiss={() => setStreamError(null)}
            dismissLabel={t("chat.dismiss")}
          >
            {streamError}
          </InlineAlert>
        )}
        {uploading && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-[hsl(var(--surface-raised))] px-3 py-2 text-small">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--primary))]"
              style={{ animation: "steadii-pulse 1.2s ease-in-out infinite" }}
            />
            <span>
              {tChat("uploading", { filename: uploading.filename })}
              <span className="text-[hsl(var(--muted-foreground))]">…</span>
            </span>
          </div>
        )}
        {voiceActive ? (
          <span
            aria-hidden
            className={cn(
              "steadii-voice-listening pointer-events-none absolute -inset-2 rounded-md",
              voiceProcessing && "steadii-voice-processing"
            )}
          />
        ) : null}
        {voice.pendingChoice ? (
          <VoiceChoice
            cleaned={voice.pendingChoice.cleaned}
            shortened={voice.pendingChoice.shortened}
            onSelect={voice.selectChoice}
          />
        ) : null}
        <form
          ref={composerRef}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          data-voice-composer="true"
          className={cn(
            "relative w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 transition-default focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]",
            voiceActive && "steadii-voice-active-ring"
          )}
        >
          <textarea
            ref={textareaRef}
            key={voiceFlashKey}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Skip Enter while the IME is composing (e.g. Japanese henkan)
              // — pressing Enter there confirms the conversion, not submit.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              voiceProcessing
                ? tVoice("processing_placeholder")
                : voiceListening
                  ? tVoice("listening_placeholder")
                  : t("chat_input.placeholder")
            }
            rows={2}
            className={cn(
              "block w-full resize-none bg-transparent px-3 py-2 text-body text-[hsl(var(--foreground))] focus:outline-none",
              voiceActive
                ? "placeholder:italic placeholder:text-[hsl(var(--muted-foreground))]"
                : "placeholder:text-[hsl(var(--muted-foreground))]",
              voiceFlashKey > 0 && "steadii-voice-text-fade-in"
            )}
            disabled={streaming}
          />
          {attachment && !uploading && (
            <div className="mx-2 mb-2 flex items-center justify-between rounded-md bg-[hsl(var(--surface-raised))] px-2 py-1 text-small">
              <span className="flex items-center gap-1.5 truncate">
                <FileTextIcon
                  size={12}
                  strokeWidth={1.5}
                  className="text-[hsl(var(--muted-foreground))]"
                />
                {attachment.filename ?? attachment.kind}
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                {t("chat.remove_attachment")}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div className="flex items-center gap-2">
              <label
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md transition-hover",
                  blobConfigured
                    ? "cursor-pointer text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
                    : "cursor-not-allowed text-[hsl(var(--muted-foreground)/0.5)]"
                )}
                title={blobConfigured ? undefined : tChat("attach_disabled_title")}
                aria-label={tChat("attach_aria")}
              >
                <Paperclip size={16} strokeWidth={1.5} />
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={!blobConfigured}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={streaming || (!input.trim() && !attachment)}
              aria-label={tChat("send_aria")}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-hover disabled:opacity-40"
            >
              <ArrowUp size={16} strokeWidth={1.75} />
            </button>
          </div>
        </form>
        {voice.hintVisible && voice.state === "idle" && !voice.pendingChoice ? (
          <p className="mt-1.5 px-1 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {voice.effectiveKey === "alt_right"
              ? tVoice("hint_alt")
              : tVoice("hint_caps")}
          </p>
        ) : null}
      </div>

    </div>
    </>
  );
}

function flushNarrationAndAddTool(msg: Message, event: ToolEvent): Message {
  const items = [...(msg.items ?? [])];
  const pending = msg.content.trim();
  if (pending) items.push({ kind: "narration", text: msg.content });
  items.push({ kind: "tool", event });
  return { ...msg, content: "", items };
}

function updateToolStatus(
  msg: Message,
  toolCallId: string,
  patch: Partial<ToolEvent>
): Message {
  if (!msg.items) return msg;
  return {
    ...msg,
    items: msg.items.map((it) =>
      it.kind === "tool" && it.event.id === toolCallId
        ? { ...it, event: { ...it.event, ...patch } }
        : it
    ),
  };
}

// engineer-58 — shape of /api/chat/messages/[id]/status response. Keep in
// sync with app/api/chat/messages/[id]/status/route.ts.
type PollStatusResponse = {
  id: string;
  chatId: string;
  status: MessageStatus;
  content: string;
  toolCalls: unknown;
  toolResults: Array<{ toolCallId: string; content: string }>;
  updatedAt: string;
};

type StoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function safeJsonParse(s: string | null | undefined): unknown {
  if (s == null || s === "") return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// engineer-58 — apply a /status poll snapshot onto the local message. The
// /status endpoint returns the assistant row's current content + toolCalls
// + the tool-response rows for those calls; rebuild `items` from those so
// the chip states match what the live stream would have produced.
function rehydrateFromPoll(msg: Message, data: PollStatusResponse): Message {
  const storedCalls = Array.isArray(data.toolCalls)
    ? (data.toolCalls as StoredToolCall[])
    : [];
  const resultByCallId = new Map<string, string>();
  for (const r of data.toolResults) resultByCallId.set(r.toolCallId, r.content);

  // Preserve any pendingId we already had locally — the /status endpoint
  // doesn't know about pendingToolCalls.id (that's a separate table), and
  // losing it would break the confirm-pending button after a resume.
  const existingPendingByCallId = new Map<string, string>();
  if (msg.items) {
    for (const it of msg.items) {
      if (
        it.kind === "tool" &&
        it.event.status === "pending" &&
        it.event.pendingId
      ) {
        existingPendingByCallId.set(it.event.id, it.event.pendingId);
      }
    }
  }

  const items: TurnItem[] =
    storedCalls.length > 0
      ? storedCalls.map((c) => {
          const rawResult = resultByCallId.get(c.id);
          const pendingId = existingPendingByCallId.get(c.id);
          const status: ToolCallStatus =
            rawResult !== undefined
              ? "done"
              : pendingId
                ? "pending"
                : "running";
          return {
            kind: "tool" as const,
            event: {
              id: c.id,
              toolName: c.function.name,
              status,
              args: safeJsonParse(c.function.arguments),
              result: rawResult !== undefined ? safeJsonParse(rawResult) : undefined,
              pendingId,
            },
          };
        })
      : (msg.items ?? []);

  return {
    ...msg,
    content: data.content,
    status: data.status,
    items: items.length > 0 ? items : msg.items,
  };
}

function InlineAlert({
  tone,
  onDismiss,
  dismissLabel,
  children,
}: {
  tone: "destructive" | "neutral";
  onDismiss: () => void;
  dismissLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center justify-between rounded-md px-3 py-2 text-small",
        tone === "destructive"
          ? "border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] text-[hsl(var(--destructive))]"
          : "border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]"
      )}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        {dismissLabel}
      </button>
    </div>
  );
}
