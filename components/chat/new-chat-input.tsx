"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Paperclip, SendHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { reportDetectedTimezone } from "@/lib/utils/report-timezone";

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

const MIN_HEIGHT_PX = 44;
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
  const [isFocused, setIsFocused] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [exampleIdx, setExampleIdx] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Rotate through example prompts when the input is idle (no caller-supplied
  // placeholder, no focus, no content). Helps new users discover what they
  // can ask the agent. Stops the moment the user engages so we don't yank
  // their reference text mid-type.
  const examples = (t.raw("example_prompts") as string[]) ?? [];
  // Rotate whenever the field is empty — even while focused. The input is
  // auto-focused on /app load, so gating on !isFocused meant users never
  // saw the rotation. We only want to stop once they actually start typing.
  const useRotation =
    !placeholder && examples.length > 1 && value.length === 0;
  useEffect(() => {
    if (!useRotation) return;
    if (typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (media.matches) return;
    }
    const FADE_MS = 260;
    const INTERVAL_MS = 4500;
    const interval = window.setInterval(() => {
      // Fade out first, swap text while invisible, then fade back in. Gives
      // a smooth cross-fade rather than the jarring hard swap of native
      // placeholder attributes.
      setFadeIn(false);
      window.setTimeout(() => {
        setExampleIdx((i) => (i + 1) % examples.length);
        setFadeIn(true);
      }, FADE_MS);
    }, INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [useRotation, examples.length]);

  // Reset to visible when rotation resumes (e.g. user blurred after typing).
  useEffect(() => {
    if (useRotation) setFadeIn(true);
  }, [useRotation]);

  // Native placeholder = stable accessible label. Visual placeholder rendered
  // as a fading overlay when rotation is active.
  const nativePlaceholder = placeholder ?? t("placeholder");
  const rotatingText = examples[exampleIdx] ?? t("placeholder");
  // Grammarly and other browser extensions inject DOM nodes into forms
  // with a textarea. That insertion happens before React hydrates, which
  // causes a hydration mismatch on the form's children. Gating the form
  // contents on mount means SSR emits only the outer shell (nothing for
  // the extension to touch yet), and the real inputs are rendered after
  // hydration — so there is no SSR-vs-client diff to complain about.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-grow the textarea up to MAX_HEIGHT_PX.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 && !isPending;
  const auraActive = isFocused || value.length > 0;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    const content = value.trim();
    const picked = file;
    setError(null);
    reportDetectedTimezone();
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
    <div className="relative w-full">
      <span
        aria-hidden
        className={cn(
          "steadii-input-aura",
          auraActive && "is-active",
          isFocused && "is-focused"
        )}
      />
      <form
        onSubmit={onSubmit}
        suppressHydrationWarning
        className={cn(
          "steadii-input-shadow group/input relative flex w-full items-end gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2 transition-default",
          isFocused &&
            "is-focused bg-[hsl(var(--surface))] ring-1 ring-[rgba(167,139,250,0.30)]"
        )}
      >
        {!mounted ? (
          <div
            aria-hidden
            className="flex h-11 flex-1 items-center px-2 text-[15px] text-[hsl(var(--muted-foreground))]"
          >
            <span className="flex-1 truncate">{nativePlaceholder}</span>
          </div>
        ) : (
          <>
            <label htmlFor="new-chat-textarea" className="sr-only">
              {t("placeholder")}
            </label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Attach image or PDF"
              aria-label="Attach image or PDF"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            >
              <Paperclip size={18} strokeWidth={1.5} />
            </button>
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                id="new-chat-textarea"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={nativePlaceholder}
                autoFocus={autoFocus}
                rows={1}
                style={{ height: MIN_HEIGHT_PX }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                  }
                }}
                className={cn(
                  "min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-[1.4] text-[hsl(var(--foreground))] focus:outline-none",
                  useRotation
                    ? "placeholder:text-transparent"
                    : "placeholder:text-[hsl(var(--muted-foreground))]"
                )}
              />
              {useRotation ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-3 top-2.5 max-w-[calc(100%-1.5rem)] truncate text-[15px] leading-[1.4] text-[hsl(var(--muted-foreground))] transition-opacity duration-[260ms] ease-out",
                    fadeIn ? "opacity-100" : "opacity-0"
                  )}
                >
                  {rotatingText}
                </span>
              ) : null}
            </div>
            <div className="flex h-11 shrink-0 items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--surface))] px-2 py-1">
                <span aria-hidden className="steadii-ai-dot" />
                <span className="font-mono text-[10px] font-medium tracking-wide text-[hsl(var(--muted-foreground))]">
                  AI Ready
                </span>
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl transition-default",
                  canSubmit
                    ? "bg-[hsl(var(--foreground))] text-[hsl(var(--surface))] hover:opacity-90"
                    : "bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))] opacity-60"
                )}
                aria-label="Send"
              >
                <SendHorizontal size={18} strokeWidth={2} />
              </button>
            </div>
          </>
        )}
      </form>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
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
        <p className="mt-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] px-3 py-1.5 text-[11px] text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-center font-medium text-[10px] tracking-wide text-[hsl(var(--muted-foreground))]">
        Press{" "}
        <span className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-1 py-0.5 font-mono">
          ⌘
        </span>{" "}
        +{" "}
        <span className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-1 py-0.5 font-mono">
          Enter
        </span>{" "}
        to send
      </p>
    </div>
  );
}
