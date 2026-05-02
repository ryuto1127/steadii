"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command, ExternalLink, SendHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { detectTutorScope } from "@/lib/chat/scope-detection";
import { reportDetectedTimezone } from "@/lib/utils/report-timezone";
import {
  persistRecents as storeRecents,
  pushRecent,
  readRecents,
} from "@/lib/utils/command-palette-recents";

// Wave 2 command palette — the docked-top input on Home that replaces
// the previous bottom-anchored chat input. Same submit semantics as
// `<NewChatInput />` (creates a chat + first message + navigates),
// extended with a focused-state dropdown showing recent commands and
// rotating examples.
//
// Cmd+K full overlay variant is OUT OF SCOPE for Wave 2 — that's Wave
// 3+ polish. We expose a Cmd+K shortcut that *focuses this docked
// input* so the muscle memory works without shipping the overlay yet.

const ROTATION_INTERVAL_MS = 4_000;

export function CommandPalette({
  autoFocus = false,
}: {
  autoFocus?: boolean;
}) {
  const t = useTranslations("command_palette");
  const tTutorOffer = useTranslations("chat.tutor_offer");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [tutorOffer, setTutorOffer] = useState<{ question: string } | null>(
    null
  );
  const [openingChatGPT, setOpeningChatGPT] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate recents from localStorage on mount. Per-device only — Wave 2
  // does not sync to DB (cost vs value; spec says "sync later if signal
  // supports").
  useEffect(() => {
    if (typeof window === "undefined") return;
    setRecents(readRecents(window.localStorage));
  }, []);

  const persistRecents = (next: string[]) => {
    setRecents(next);
    if (typeof window === "undefined") return;
    storeRecents(window.localStorage, next);
  };

  // Cmd+K / Ctrl+K focus shortcut. Wave 3 will replace this with a true
  // overlay variant; for Wave 2 we just bring the docked input into
  // focus and select-all so the user can immediately type.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() !== "k") return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable) &&
        active === inputRef.current
      ) {
        return;
      }
      e.preventDefault();
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Rotate the placeholder example. Stops the moment the user starts
  // typing so we don't yank their reference text mid-thought.
  const examples = (t.raw("examples") as string[]) ?? [];
  const examplesShort = (t.raw("examples_short") as string[]) ?? examples;
  const useRotation = examplesShort.length > 1 && value.length === 0;
  useEffect(() => {
    if (!useRotation) return;
    if (typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (media.matches) return;
    }
    const id = window.setInterval(() => {
      setExampleIdx((i) => (i + 1) % examplesShort.length);
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [useRotation, examplesShort.length]);

  const placeholder = useRotation
    ? examplesShort[exampleIdx] ?? t("placeholder_default")
    : t("placeholder_default");

  const submit = (content: string) => {
    setTutorOffer(null);
    reportDetectedTimezone();
    persistRecents(pushRecent(recents, content));
    startTransition(async () => {
      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        const created = (await resp.json()) as { id?: string };
        if (!created.id) throw new Error("No chat id returned");
        setValue("");
        router.push(`/app/chat/${created.id}?stream=1`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't start a new chat."
        );
      }
    });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = value.trim();
    if (content.length === 0 || pending) return;
    const detection = detectTutorScope(content);
    if (detection.isTutor) {
      setTutorOffer({ question: content });
      return;
    }
    submit(content);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.currentTarget.blur();
      setFocused(false);
    }
  };

  const askAnyway = () => {
    if (!tutorOffer) return;
    submit(tutorOffer.question);
  };

  const openInChatGPT = async () => {
    if (!tutorOffer) return;
    setOpeningChatGPT(true);
    const popup = window.open("about:blank", "_blank");
    try {
      const resp = await fetch("/api/chat/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: tutorOffer.question }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { url?: string };
      if (!body.url) throw new Error("no url");
      if (popup) popup.location.href = body.url;
      else window.open(body.url, "_blank");
      setTutorOffer(null);
      setValue("");
    } catch {
      if (popup) popup.close();
      toast.error(tTutorOffer("open_failed"));
    } finally {
      setOpeningChatGPT(false);
    }
  };

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      {tutorOffer ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4 shadow-[0_4px_20px_-8px_rgba(20,20,40,0.08)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--surface))] text-[hsl(var(--primary))]"
            >
              <Sparkles size={14} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-[hsl(var(--foreground))]">
                {tTutorOffer("heading")}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
                {tTutorOffer("body")}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openInChatGPT}
                  disabled={openingChatGPT}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default",
                    openingChatGPT ? "opacity-60" : "hover:opacity-90"
                  )}
                >
                  {openingChatGPT ? (
                    <span>{tTutorOffer("preparing")}</span>
                  ) : (
                    <>
                      <ExternalLink size={12} strokeWidth={2} />
                      <span>{tTutorOffer("open_in_chatgpt")}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={askAnyway}
                  disabled={openingChatGPT || pending}
                  className="inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
                >
                  {tTutorOffer("ask_anyway")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className={cn(
          "flex h-12 items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 transition-default",
          focused &&
            "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--surface))] shadow-[0_4px_20px_-8px_hsl(var(--primary)/0.18)]"
        )}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]"
        >
          <Command size={15} strokeWidth={1.75} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so a click on a Recent item still fires before the
            // blur tears down the dropdown.
            setTimeout(() => setFocused(false), 150);
          }}
          onKeyDown={onInputKey}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("placeholder_default")}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[15px] text-[hsl(var(--foreground))] focus:outline-none placeholder:text-[hsl(var(--muted-foreground))]"
        />
        <span
          aria-hidden
          className="hidden shrink-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] sm:inline-flex"
        >
          {t("keyboard_hint")}
        </span>
        <button
          type="submit"
          disabled={value.trim().length === 0 || pending}
          aria-label={t("submit_aria")}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-default",
            value.trim().length > 0 && !pending
              ? "bg-[hsl(var(--foreground))] text-[hsl(var(--surface))] hover:opacity-90"
              : "bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))] opacity-60"
          )}
        >
          <SendHorizontal size={15} strokeWidth={2} />
        </button>
      </form>

      {focused && !tutorOffer ? (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[0_8px_30px_rgba(0,0,0,0.10)]"
          role="listbox"
          aria-label={t("recent_heading")}
        >
          {recents.length > 0 ? (
            <div className="border-b border-[hsl(var(--border))] py-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("recent_heading")}
              </p>
              {recents.map((r) => (
                <button
                  key={r}
                  type="button"
                  onMouseDown={(e) => {
                    // mouseDown not click — click fires after blur.
                    e.preventDefault();
                    setValue(r);
                    inputRef.current?.focus();
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
                >
                  {r}
                </button>
              ))}
            </div>
          ) : (
            <div className="border-b border-[hsl(var(--border))] py-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("recent_heading")}
              </p>
              <p className="px-3 py-1.5 text-[12px] italic text-[hsl(var(--muted-foreground))]">
                {t("recent_empty")}
              </p>
            </div>
          )}
          <div className="py-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {t("examples_heading")}
            </p>
            {examples.slice(0, 4).map((ex) => (
              <button
                key={ex}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(ex);
                  inputRef.current?.focus();
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
