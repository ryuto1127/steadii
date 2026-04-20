"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Attachment = {
  id: string;
  kind: "image" | "pdf";
  url: string;
  filename: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  attachments: Attachment[];
};

export function ChatView({
  chatId,
  initialMessages,
}: {
  chatId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [, startTransition] = useTransition();
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    if (!input.trim() && !attachment) return;
    const text = input.trim();

    const userMsg: Message = {
      id: "temp-" + Date.now(),
      role: "user",
      content: text,
      attachments: attachment ? [attachment] : [],
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    const usedAttachment = attachment;
    setAttachment(null);

    const res = await fetch(`/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        content: text,
        attachmentMessageId: usedAttachment ? userMsg.id.startsWith("temp-") : undefined,
      }),
    });
    if (!res.ok) {
      console.error("post message failed", await res.text());
      return;
    }
    const { messageId } = (await res.json()) as { messageId: string };
    setMessages((m) =>
      m.map((x) => (x.id === userMsg.id ? { ...x, id: messageId } : x))
    );

    const assistantTempId = "assistant-" + Date.now();
    setMessages((m) => [
      ...m,
      { id: assistantTempId, role: "assistant", content: "", attachments: [] },
    ]);

    setStreaming(true);
    try {
      const sse = await fetch(`/api/chat?chatId=${encodeURIComponent(chatId)}`, {
        headers: { Accept: "text/event-stream" },
      });
      if (!sse.body) throw new Error("no stream");
      const reader = sse.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
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
            if (payload.type === "text_delta") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === assistantTempId
                    ? { ...x, content: x.content + payload.delta }
                    : x
                )
              );
            } else if (payload.type === "message_start" && payload.assistantMessageId) {
              setMessages((m) =>
                m.map((x) =>
                  x.id === assistantTempId
                    ? { ...x, id: payload.assistantMessageId }
                    : x
                )
              );
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    } finally {
      setStreaming(false);
      startTransition(() => router.refresh());
    }
  }

  async function uploadFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("chatId", chatId);
    const res = await fetch("/api/chat/attachments", { method: "POST", body: fd });
    if (!res.ok) {
      alert(`upload failed: ${await res.text()}`);
      return;
    }
    const body = (await res.json()) as { attachment: Attachment };
    setAttachment(body.attachment);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-1 overflow-y-auto py-6">
        {messages.length === 0 && (
          <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Ask anything about your classes, assignments, or a problem you&apos;re stuck on.
          </p>
        )}
        <ul className="space-y-6">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] rounded-xl bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm"
                    : "max-w-[85%] text-sm leading-relaxed"
                }
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
                          className="max-h-64 rounded-md"
                        />
                      ) : (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline"
                        >
                          {a.filename ?? "PDF"}
                        </a>
                      )
                    )}
                  </div>
                )}
                {m.content || (
                  <span className="text-[hsl(var(--muted-foreground))]">…</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div ref={scrollAnchor} />
      </div>

      <div className="border-t border-[hsl(var(--border))] py-4">
        {attachment && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-[hsl(var(--surface-raised))] px-3 py-2 text-xs">
            <span>
              Attached: {attachment.filename ?? attachment.kind}
            </span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Remove
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <label className="cursor-pointer rounded-md border border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]">
            Attach
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message Steadii…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || (!input.trim() && !attachment)}
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90 disabled:opacity-40"
          >
            {streaming ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
