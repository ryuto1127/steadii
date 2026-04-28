"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, MessageSquare } from "lucide-react";

const CHAR_MS = 28;

type CardCopy = { input: string; action: string };

export function ChatActionCards({ cards }: { cards: CardCopy[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card, i) => (
        <ChatActionCard key={i} card={card} delayMs={i * 200} />
      ))}
    </div>
  );
}

function ChatActionCard({ card, delayMs }: { card: CardCopy; delayMs: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "typing" | "done">("idle");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTyped(card.input);
      setPhase("done");
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && phase === "idle") {
            const start = window.setTimeout(() => setPhase("typing"), delayMs);
            obs.disconnect();
            return () => window.clearTimeout(start);
          }
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [card.input, delayMs, phase]);

  useEffect(() => {
    if (phase !== "typing") return;
    if (typed.length >= card.input.length) {
      const timer = window.setTimeout(() => setPhase("done"), 350);
      return () => window.clearTimeout(timer);
    }
    const next = card.input.slice(0, typed.length + 1);
    const timer = window.setTimeout(() => setTyped(next), CHAR_MS);
    return () => window.clearTimeout(timer);
  }, [phase, typed, card.input]);

  const showCursor = phase === "typing";
  const showAction = phase === "done";

  return (
    <div
      ref={ref}
      className="flex flex-col gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
    >
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        You type
      </p>
      <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2.5">
        <MessageSquare
          size={14}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]"
        />
        <p className="min-h-[1.4em] flex-1 text-small text-[hsl(var(--foreground))]">
          {typed}
          {showCursor ? (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[0.95em] w-[0.5em] -translate-y-[0.05em] bg-[hsl(var(--primary))] align-middle"
              style={{ animation: "steadii-tail-cursor 1s steps(1) infinite" }}
            />
          ) : null}
        </p>
      </div>
      <div
        className={`flex items-start gap-2 transition-opacity duration-300 ${showAction ? "opacity-100" : "opacity-0"}`}
        aria-hidden={!showAction}
      >
        <ArrowRight
          size={14}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0 text-[hsl(var(--primary))]"
        />
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          {card.action}
        </p>
      </div>
    </div>
  );
}
