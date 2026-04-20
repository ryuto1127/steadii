"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Paperclip, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

// Creates a chat and lands on /app/chat/[id]?stream=1 with the first message
// already posted. The chat-view on the next page reads `stream=1` to auto-
// trigger the agent response.
async function createChatAndPost(
  content: string,
  file?: File | null
): Promise<string | { error: string }> {
  const createResp = await fetch("/api/chat", { method: "POST" });
  if (!createResp.ok) {
    return { error: "Couldn't start a new chat." };
  }
  const created = (await createResp.json()) as { id?: string; error?: string };
  if (!created.id) {
    return { error: created.error ?? "Couldn't start a new chat." };
  }
  const chatId = created.id;

  // If a file is attached, /api/chat/attachments writes its own message
  // (containing the attachment) onto the chat. The text becomes a follow-
  // up user message in the same chat.
  if (file) {
    const form = new FormData();
    form.set("file", file);
    form.set("chatId", chatId);
    const up = await fetch("/api/chat/attachments", {
      method: "POST",
      body: form,
    });
    if (!up.ok) {
      let msg = "Upload failed.";
      try {
        const body = await up.json();
        if (typeof body?.error === "string") msg = body.error;
      } catch {
        // ignore
      }
      return { error: msg };
    }
  }

  const post = await fetch("/api/chat/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, content }),
  });
  if (!post.ok) {
    let msg = "Couldn't send the message.";
    try {
      const body = await post.json();
      if (typeof body?.error === "string") msg = body.error;
    } catch {
      // ignore
    }
    return { error: msg };
  }
  return chatId;
}

const MIN_HEIGHT_PX = 48;
const MAX_HEIGHT_PX = 200;

export function NewChatInput({
  placeholder,
  autoFocus = false,
}: {
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("chat_input");
  const tChat = useTranslations("chat");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to MAX_HEIGHT_PX.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 && !isPending;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    const content = value.trim();
    const picked = file;
    setError(null);
    startTransition(async () => {
      const result = await createChatAndPost(content, picked);
      if (typeof result === "string") {
        setValue("");
        setFile(null);
        router.push(`/app/chat/${result}?stream=1`);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "relative w-full rounded-[10px] border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface))] transition-default",
        "focus-within:border-[hsl(var(--primary)/0.4)] focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
      )}
    >
      <label htmlFor="new-chat-textarea" className="sr-only">
        {t("placeholder")}
      </label>
      <div className="flex items-start gap-2 px-2.5">
        <span
          aria-hidden
          className="pt-[14px] font-mono text-[12px] leading-none text-[hsl(var(--muted-foreground))]"
        >
          ▸
        </span>
        <textarea
          ref={textareaRef}
          id="new-chat-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? t("placeholder")}
          autoFocus={autoFocus}
          rows={1}
          style={{ height: MIN_HEIGHT_PX }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          className="block w-full resize-none bg-transparent py-[10px] pr-2 text-body leading-[1.45] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
        />
        <div className="flex shrink-0 items-center gap-1.5 pt-[10px]">
          <span aria-hidden className="ai-pulse" title="AI ready" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-5 w-5 items-center justify-center rounded text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            aria-label="Attach image or PDF"
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded text-[hsl(var(--muted-foreground))] transition-hover",
              canSubmit
                ? "text-[hsl(var(--primary))] hover:opacity-80"
                : "opacity-50"
            )}
            aria-label="Send"
          >
            <ArrowUp size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="ml-auto transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {tChat("remove_attachment")}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="border-t border-[hsl(var(--destructive)/0.3)] px-3 py-1.5 text-[11px] text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
