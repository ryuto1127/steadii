"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Phase 7 W1 — splits the reasoning string into bullet lines (when the
// model emitted bullet markers), and within each line/paragraph turns
// per-source citation tags (mistake-N, syllabus-N, calendar-N, email-N)
// into clickable footnote markers. The same tags are emitted by the
// fanout-prompt builder; the model is required by the system prompt to
// cite at least one when fanout context exists.
//
// Collapse threshold bumped from 400 → 800 chars (per scoping §12.11)
// since W1 reasoning routinely cites multiple sources. Bullet rendering
// has no collapse — a list is already legible at any length.
const COLLAPSE_AT = 800;

const CITATION_RE = /\((mistake|syllabus|calendar|email)-(\d+)\)/g;

export function ReasoningPanel({ reasoning }: { reasoning: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning || reasoning.trim().length === 0) return null;

  const trimmed = reasoning.trim();
  const bullets = extractBullets(trimmed);
  const long = trimmed.length > COLLAPSE_AT;
  const shown = long && !expanded ? trimmed.slice(0, COLLAPSE_AT) + "…" : trimmed;

  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Why this draft
      </h2>
      {bullets.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-[hsl(var(--foreground))]">
          {bullets.map((b, i) => (
            <li key={i}>{renderWithCitations(b)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-small leading-relaxed text-[hsl(var(--foreground))]">
          {renderWithCitations(shown)}
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

// Replace each `(mistake-1)` / `(syllabus-2)` / `(calendar-3)` / `(email-4)`
// substring with a styled superscript marker. We use data-source-ref so a
// future wire-up can scroll to the matching pill in ThinkingBar.
//
// Pre-W1 reasoning rows have no citation tags at all — matchAll returns
// an empty iterator and we fall through to plain text. The try/catch is
// belt-and-braces against any future regex regression (a stray callsite
// passing a non-string here would crash the page); we'd rather render
// the raw text than the route-level error boundary.
function renderWithCitations(text: string): ReactNode {
  if (typeof text !== "string") return text ?? null;
  try {
    const parts: ReactNode[] = [];
    let last = 0;
    let idx = 0;
    for (const m of text.matchAll(CITATION_RE)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (start > last) parts.push(text.slice(last, start));
      const kind = m[1];
      const n = m[2];
      parts.push(
        <sup
          key={`cite-${idx++}-${kind}-${n}`}
          data-source-ref={`${kind}-${n}`}
          className="ml-0.5 inline-block rounded-sm bg-[hsl(var(--surface-raised))] px-1 font-mono text-[10px] text-[hsl(var(--primary))]"
        >
          {kind}-{n}
        </sup>
      );
      last = end;
    }
    if (last < text.length) parts.push(text.slice(last));
    if (parts.length === 0) return text;
    return parts;
  } catch {
    return text;
  }
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
