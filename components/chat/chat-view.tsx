"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, ArrowUp, FileText as FileTextIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { MistakeNoteDialog } from "./mistake-note-dialog";
import { MarkdownMessage } from "./markdown-message";
import { ToolCallCard, type ToolCallStatus } from "./tool-call-card";
import { ActionPill } from "@/components/ui/action-pill";
import { cn } from "@/lib/utils/cn";
import { reportDetectedTimezone } from "@/lib/utils/report-timezone";

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

type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  items?: TurnItem[];
  attachments: Attachment[];
};

export function ChatView({
  chatId,
  initialMessages,
  blobConfigured = true,
  autoStream = false,
}: {
  chatId: string;
  initialMessages: Message[];
  blobConfigured?: boolean;
  autoStream?: boolean;
}) {
  const t = useTranslations();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [mistakeFor, setMistakeFor] = useState<string | null>(null);
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

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Auto-trigger the stream when the URL has ?stream=1 (e.g., user hit send
  // from the Home input and was routed here with a fresh user message that
  // already exists in the DB).
  useEffect(() => {
    if (autoStream && !didAutoStream.current) {
      didAutoStream.current = true;
      void runStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStream]);

  async function runStream() {
    setStreamError(null);
    setStreaming(true);
    const assistantTempId = "assistant-" + Date.now();
    setMessages((m) => [
      ...m,
      { id: assistantTempId, role: "assistant", content: "", attachments: [] },
    ]);
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
              setMessages((m) =>
                m.map((x) =>
                  x.id === assistantTempId ? { ...x, id: currentAssistantId } : x
                )
              );
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
            } else if (payload.type === "error") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === currentAssistantId
                    ? {
                        ...x,
                        role: "assistant",
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
    setMessages((m) =>
      m.map((msg) => ({
        ...msg,
        items: msg.items?.map((it) =>
          it.kind === "tool" && it.event.pendingId === pendingId
            ? {
                ...it,
                event: {
                  ...it.event,
                  status: decision === "approve" ? "done" : "denied",
                },
              }
            : it
        ),
      }))
    );
    await runStream();
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
        setStreamError("Failed to send message.");
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
        let friendly = `Upload failed (HTTP ${res.status}).`;
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
    <div className="flex h-[calc(100dvh-12rem)] flex-col md:h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-5">
          {messages.map((m, idx) => {
            const isLastAssistant =
              m.role === "assistant" && idx === messages.length - 1;
            const showCursor = streaming && isLastAssistant && !hasAnyPending;
            const isUserMsg = m.role === "user";
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
                    <div className="mb-2 space-y-1">
                      {m.items.map((it, i) =>
                        it.kind === "narration" ? (
                          <p
                            key={`n-${i}`}
                            className="whitespace-pre-wrap text-small italic text-[hsl(var(--muted-foreground))]"
                          >
                            {it.text}
                          </p>
                        ) : (
                          <ToolCallCard
                            key={`t-${it.event.id}`}
                            toolName={it.event.toolName}
                            status={it.event.status}
                            args={it.event.args}
                            result={it.event.result}
                            pendingId={it.event.pendingId}
                            onConfirm={(d) =>
                              it.event.pendingId &&
                              confirmPending(it.event.pendingId, d)
                            }
                          />
                        )
                      )}
                    </div>
                  )}
                  {m.content ? (
                    m.role === "assistant" ? (
                      <div className={cn(showCursor && "streaming-cursor")}>
                        <MarkdownMessage content={m.content} />
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )
                  ) : m.role === "assistant" && streaming && !hasAnyPending ? (
                    <span className="streaming-cursor" aria-label="Thinking" />
                  ) : m.role === "assistant" && !m.items?.length ? (
                    <span className="text-[hsl(var(--muted-foreground))]">…</span>
                  ) : null}
                  {m.role === "assistant" &&
                    m.content &&
                    !m.id.startsWith("assistant-") && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <ActionPill onClick={() => setMistakeFor(m.id)} tone="primary">
                          {t("chat.actions.add_to_mistakes")}
                        </ActionPill>
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
            Image and PDF uploads are disabled until
            <code className="mx-1 font-mono text-[hsl(var(--foreground))]">
              BLOB_READ_WRITE_TOKEN
            </code>
            is set. Ask the administrator.
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
              Uploading {uploading.filename}
              <span className="text-[hsl(var(--muted-foreground))]">…</span>
            </span>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="relative w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 transition-default focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
        >
          <textarea
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
            placeholder={t("chat_input.placeholder")}
            rows={2}
            className="block w-full resize-none bg-transparent px-3 py-2 text-body text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
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
                title={
                  blobConfigured
                    ? undefined
                    : "Image uploads require Vercel Blob. Ask the administrator to configure BLOB_READ_WRITE_TOKEN."
                }
                aria-label="Attach"
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
              aria-label="Send"
              className="flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-hover disabled:opacity-40"
            >
              <ArrowUp size={16} strokeWidth={1.75} />
            </button>
          </div>
        </form>
      </div>

      <MistakeNoteDialog
        chatId={chatId}
        assistantMessageId={mistakeFor ?? ""}
        open={!!mistakeFor}
        onClose={() => setMistakeFor(null)}
      />
    </div>
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
