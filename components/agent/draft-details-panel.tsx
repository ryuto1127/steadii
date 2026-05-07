"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Mail,
  AlertTriangle,
  BookOpen,
  Calendar as CalendarIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type {
  RetrievalProvenance,
  RetrievalProvenanceSource,
} from "@/lib/db/schema";

// Combined reasoning + sources panel for /app/inbox/[id]. Collapsed by
// default so the draft + send/edit buttons stay primary; expand reveals
// the audit trail. Replaces the prior ThinkingBar + ReasoningPanel
// duplication on this surface (the standalone ReasoningPanel +
// ThinkingBar still ship for the /settings/how-your-agent-thinks
// debug page where full-transparency-by-default is the right default).
//
// Source pills become clickable when we have a route to point at:
//   - syllabus → /app/classes/<classId>?tab=syllabus (when classId set)
//   - mistake  → /app/classes/<classId>?tab=mistakes
//   - calendar → /app/calendar
//   - email    → not linked yet (the inbox detail route is keyed by
//                agent_drafts.id, not inbox_items.id; surfacing a
//                deep link needs a mini lookup we'll add in a later PR)

const KNOWN_SOURCE_TYPES = new Set([
  "email",
  "mistake",
  "syllabus",
  "calendar",
]);

const CITATION_RE = /\((mistake|syllabus|calendar|email)-(\d+)\)/g;

function normalizeSources(
  raw: RetrievalProvenance["sources"] | undefined
): RetrievalProvenanceSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is RetrievalProvenanceSource =>
      !!s &&
      typeof s === "object" &&
      typeof (s as { type?: unknown }).type === "string" &&
      KNOWN_SOURCE_TYPES.has((s as { type: string }).type)
  );
}

type ReasoningAction =
  | "draft_reply"
  | "ask_clarifying"
  | "archive"
  | "snooze"
  | "no_op"
  | "notify_only"
  | "paused";

export function DraftDetailsPanel({
  reasoning,
  action,
  provenance,
}: {
  reasoning: string | null;
  action?: ReasoningAction | null;
  provenance: RetrievalProvenance | null;
}) {
  const t = useTranslations("agent.draft_details");
  const tReasoning = useTranslations("agent.reasoning_panel");
  const [expanded, setExpanded] = useState(false);

  const sources = normalizeSources(provenance?.sources);
  const trimmed = (reasoning ?? "").trim();
  const hasReasoning = trimmed.length > 0;
  const hasSources = sources.length > 0;
  if (!hasReasoning && !hasSources) return null;

  const summary = t(
    expanded ? "collapse" : "expand",
    {
      n_sources: sources.length,
    }
  );

  return (
    <section
      aria-labelledby="draft-details-toggle"
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]"
    >
      <button
        id="draft-details-toggle"
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))]">
          {summary}
        </span>
        {expanded ? (
          <ChevronUp size={14} strokeWidth={1.75} className="text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronDown size={14} strokeWidth={1.75} className="text-[hsl(var(--muted-foreground))]" />
        )}
      </button>
      {expanded ? (
        <div className="border-t border-[hsl(var(--border))] px-4 py-3 space-y-3">
          {hasReasoning ? (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {tReasoning(reasoningHeaderKey(action))}
              </h3>
              {(() => {
                const bullets = extractBullets(trimmed);
                return bullets.length > 0 ? (
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-[hsl(var(--foreground))]">
                    {bullets.map((b, i) => (
                      <li key={i}>{renderWithCitations(b)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small leading-relaxed text-[hsl(var(--foreground))]">
                    {renderWithCitations(trimmed)}
                  </p>
                );
              })()}
            </div>
          ) : null}
          {hasSources ? (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("sources_heading")}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s, i) => (
                  <SourcePill key={pillKey(s, i)} source={s} index={i + 1} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function reasoningHeaderKey(action: ReasoningAction | null | undefined) {
  switch (action) {
    case "draft_reply":
      return "header_draft_reply";
    case "ask_clarifying":
      return "header_ask_clarifying";
    case "archive":
      return "header_archive";
    case "snooze":
      return "header_snooze";
    case "no_op":
      return "header_no_op";
    case "notify_only":
      return "header_notify_only";
    case "paused":
      return "header_paused";
    default:
      return "header_default";
  }
}

function SourcePill({
  source,
  index,
}: {
  source: RetrievalProvenanceSource;
  index: number;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]";

  switch (source.type) {
    case "email": {
      // Not linkable yet (agent_drafts.id ≠ inbox_items.id).
      return (
        <span
          title={source.snippet}
          className={`${base} border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]`}
        >
          <Mail size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            email-{index}
          </span>
          <span className="font-mono tabular-nums">
            {formatSimilarityPct(source.similarity)}
          </span>
          <span className="max-w-[180px] truncate">
            {source.snippet || "email"}
          </span>
        </span>
      );
    }
    case "mistake": {
      const href = source.classId
        ? `/app/classes/${source.classId}?tab=mistakes`
        : null;
      const inner = (
        <>
          <AlertTriangle size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            mistake-{index}
          </span>
          <span className="max-w-[180px] truncate">
            {source.snippet || "past mistake"}
          </span>
        </>
      );
      const cls = `${base} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300${
        href ? " transition-hover hover:bg-amber-500/20" : ""
      }`;
      return href ? (
        <Link href={href} title={source.snippet} className={cls}>
          {inner}
        </Link>
      ) : (
        <span title={source.snippet} className={cls}>
          {inner}
        </span>
      );
    }
    case "syllabus": {
      const href = source.classId
        ? `/app/classes/${source.classId}?tab=syllabus`
        : null;
      const inner = (
        <>
          <BookOpen size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            syllabus-{index}
          </span>
          <span className="font-mono tabular-nums">
            {formatSimilarityPct(source.similarity)}
          </span>
          <span className="max-w-[180px] truncate">
            {source.snippet || "syllabus chunk"}
          </span>
        </>
      );
      const cls = `${base} border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300${
        href ? " transition-hover hover:bg-violet-500/20" : ""
      }`;
      return href ? (
        <Link href={href} title={source.snippet} className={cls}>
          {inner}
        </Link>
      ) : (
        <span title={source.snippet} className={cls}>
          {inner}
        </span>
      );
    }
    case "calendar": {
      const href = "/app/calendar";
      const tooltip = `${source.title} — ${source.start}${
        source.end ? ` → ${source.end}` : ""
      }`;
      return (
        <Link
          href={href}
          title={tooltip}
          className={`${base} border-sky-500/30 bg-sky-500/10 text-sky-700 transition-hover hover:bg-sky-500/20 dark:text-sky-300`}
        >
          <CalendarIcon size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            calendar-{index}
          </span>
          <span className="max-w-[180px] truncate">{source.title}</span>
        </Link>
      );
    }
  }
}

function pillKey(source: RetrievalProvenanceSource, index: number): string {
  return `${source.type}:${source.id}:${index}`;
}

function formatSimilarityPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function renderWithCitations(text: string) {
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
  const bulletLike = lines.every((l) => /^[-•*]|\d+[.)]\s/.test(l));
  if (!bulletLike || lines.length < 2) return [];
  return lines.map((l) => l.replace(/^[-•*]\s*|\d+[.)]\s*/, "").trim());
}
