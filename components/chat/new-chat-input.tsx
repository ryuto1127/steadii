"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
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
  if (!created.id) return { error: created.error ?? "Couldn't start a new chat." };

  const chatId = created.id;

  let attachmentId: string | undefined;
  if (file) {
    const form = new FormData();
    form.set("file", file);
    form.set("chatId", chatId);
    const up = await fetch("/api/chat/attachments", { method: "POST", body: form });
    if (up.ok) {
      const j = (await up.json()) as { id?: string };
      attachmentId = j.id;
    }
  }

  const fd = new FormData();
  fd.set("chatId", chatId);
  fd.set("content", content);
  if (attachmentId) fd.set("attachmentId", attachmentId);
  const post = await fetch("/api/chat/message", { method: "POST", body: fd });
  if (!post.ok) {
    return { error: "Couldn't send the message." };
  }
  return chatId;
}

export function NewChatInput({
  placeholder,
  autoFocus = false,
}: {
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("chat_input");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

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
        "relative w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 transition-default",
        "focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
      )}
    >
      <label htmlFor="new-chat-textarea" className="sr-only">
        Message Steadii
      </label>
      <textarea
        id="new-chat-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t("placeholder")}
        autoFocus={autoFocus}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
        className="block w-full resize-none bg-transparent px-3 py-2 text-body text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            aria-label="Attach image or PDF"
          >
            <Paperclip size={14} strokeWidth={1.5} />
          </button>
          {file ? (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="truncate rounded-md border border-[hsl(var(--border))] px-2 py-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              title="Click to remove"
            >
              {file.name}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
          <span className="font-mono text-[11px] opacity-60">{t("send_hint")}</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-hover disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {error ? (
        <p className="mt-2 px-3 text-small text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </form>
  );
}
