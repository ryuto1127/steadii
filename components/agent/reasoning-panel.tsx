"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Splits the reasoning string into bullet lines when the model used bullet
// markers (`-`, `•`, or numbered list). Otherwise renders as a paragraph.
// Collapses when over 400 chars.
export function ReasoningPanel({ reasoning }: { reasoning: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning || reasoning.trim().length === 0) return null;

  const trimmed = reasoning.trim();
  const bullets = extractBullets(trimmed);
  const long = trimmed.length > 400;
  const shown = long && !expanded ? trimmed.slice(0, 400) + "…" : trimmed;

  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Why this draft
      </h2>
      {bullets.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-[hsl(var(--foreground))]">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-small leading-relaxed text-[hsl(var(--foreground))]">
          {shown}
        </p>
      )}
      {long && bullets.length === 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {expanded ? (
            <>
              <ChevronUp size={12} strokeWidth={1.75} />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown size={12} strokeWidth={1.75} />
              Expand
            </>
          )}
        </button>
      ) : null}
    </section>
  );
}

function extractBullets(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const bulletLike = lines.every((l) =>
    /^[-•*]|\d+[.)]\s/.test(l)
  );
  if (!bulletLike || lines.length < 2) return [];
  return lines.map((l) => l.replace(/^[-•*]\s*|\d+[.)]\s*/, "").trim());
}
