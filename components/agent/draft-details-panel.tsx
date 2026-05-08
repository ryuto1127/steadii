"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Mail,
  AlertTriangle,
  BookOpen,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  ListTodo,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type {
  ExtractedActionItem,
  RetrievalProvenance,
  RetrievalProvenanceSource,
} from "@/lib/db/schema";
import { acceptDraftActionItemAction } from "@/app/app/inbox/[id]/_actions";

// engineer-39 — UI floor mirrors the constant in classify-deep.ts. Items
// below the floor are dropped here even if the model emitted them, so
// a future prompt regression can't quietly fill the panel with
// low-signal noise.
const MIN_ACTION_ITEM_CONFIDENCE = 0.6;

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
  // engineer-38 — past replies the user wrote to the same sender.
  "sender_history",
]);

// engineer-38 — citation tags now include `self-N` (sender history).
// `mistake-N` stays in the regex so legacy reasoning rows persisted before
// PR #182 still render their citations correctly even though new fanouts
// no longer emit that source.
const CITATION_RE =
  /\((mistake|syllabus|calendar|email|self)-(\d+)\)/g;

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
  draftId,
  reasoning,
  action,
  provenance,
  actionItems,
  acceptedIndices,
}: {
  draftId?: string;
  reasoning: string | null;
  action?: ReasoningAction | null;
  provenance: RetrievalProvenance | null;
  // engineer-39 — extracted to-dos from the deep pass. Optional so
  // legacy callers (e.g. how-your-agent-thinks history) can omit them
  // and the panel falls through to its prior reasoning + sources only.
  actionItems?: ExtractedActionItem[] | null;
  acceptedIndices?: number[] | null;
}) {
  const t = useTranslations("agent.draft_details");
  const tReasoning = useTranslations("agent.reasoning_panel");
  const [expanded, setExpanded] = useState(false);

  const sources = normalizeSources(provenance?.sources);
  const trimmed = (reasoning ?? "").trim();
  const hasReasoning = trimmed.length > 0;
  const hasSources = sources.length > 0;
  // engineer-39 — surface the action-items section for any draft that
  // has at least one item above the confidence floor. Empty or
  // sub-floor items collapse the section so it doesn't render as a
  // "0 detected" footnote.
  const visibleActionItems = (actionItems ?? []).filter(
    (i) => i.confidence >= MIN_ACTION_ITEM_CONFIDENCE
  );
  const hasActionItems = !!draftId && visibleActionItems.length > 0;
  if (!hasReasoning && !hasSources && !hasActionItems) return null;

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
          {hasActionItems && draftId ? (
            <ActionItemsSection
              draftId={draftId}
              items={visibleActionItems}
              accepted={acceptedIndices ?? []}
              originalIndices={(actionItems ?? []).map((_, i) => i).filter((i) =>
                ((actionItems ?? [])[i]?.confidence ?? 0) >=
                MIN_ACTION_ITEM_CONFIDENCE
              )}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// engineer-39 — action items live inside the same DraftDetailsPanel as
// reasoning + sources so the user opens one collapsible section and sees
// "everything Steadii thinks about this email." Each item gets one of
// two affordances: an "Add to my tasks" button when not yet accepted,
// or a green ✓ "Added" pill once accepted (idempotent — see the
// acceptDraftActionItemAction comment).
function ActionItemsSection({
  draftId,
  items,
  accepted,
  originalIndices,
}: {
  draftId: string;
  items: ExtractedActionItem[];
  accepted: number[];
  // Map from rendered position → original index in the draft row's
  // `extractedActionItems` array. We filter sub-floor items out before
  // rendering, but the server action keys on the persisted index, so
  // the panel needs to thread the original index back to the click
  // handler.
  originalIndices: number[];
}) {
  const t = useTranslations("agent.draft_details.action_items");
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        <ListTodo size={11} strokeWidth={1.75} />
        {t("heading", { n: items.length })}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => {
          const originalIndex = originalIndices[i] ?? i;
          const isAccepted = accepted.includes(originalIndex);
          return (
            <ActionItemRow
              key={`${originalIndex}-${item.title}`}
              draftId={draftId}
              item={item}
              originalIndex={originalIndex}
              accepted={isAccepted}
            />
          );
        })}
      </ul>
    </div>
  );
}

function ActionItemRow({
  draftId,
  item,
  originalIndex,
  accepted,
}: {
  draftId: string;
  item: ExtractedActionItem;
  originalIndex: number;
  accepted: boolean;
}) {
  const t = useTranslations("agent.draft_details.action_items");
  const [optimisticAccepted, setOptimisticAccepted] = useState(accepted);
  const [isPending, startTransition] = useTransition();

  const onAdd = () => {
    if (optimisticAccepted) return;
    setOptimisticAccepted(true);
    startTransition(async () => {
      try {
        const res = await acceptDraftActionItemAction(draftId, originalIndex);
        if (res.ok) {
          if (!res.alreadyAccepted) toast.success(t("toast_added"));
        } else {
          setOptimisticAccepted(false);
          toast.error(t("toast_failed"));
        }
      } catch {
        setOptimisticAccepted(false);
        toast.error(t("toast_failed"));
      }
    });
  };

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-small">
      <div className="min-w-0 flex-1">
        <div className="text-[hsl(var(--foreground))]">{item.title}</div>
        {item.dueDate ? (
          <div className="mt-0.5 inline-block rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
            {item.dueDate}
          </div>
        ) : null}
      </div>
      {optimisticAccepted ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[hsl(142_76%_36%/0.1)] px-2.5 py-1 text-[11px] font-medium text-[hsl(142_76%_36%)]">
          <CheckCircle2 size={12} strokeWidth={1.75} />
          {t("added")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
        >
          <Plus size={12} strokeWidth={1.75} />
          {isPending ? t("adding") : t("add_to_tasks")}
        </button>
      )}
    </li>
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
    case "sender_history": {
      // engineer-38 — past reply Ryuto sent to the same sender. Not
      // linkable yet (the sent-draft surface lives in the inbox detail
      // and the link plumbing requires a separate lookup). Compact
      // "self-N · 4/22" label so the pill row stays scannable.
      const date = formatShortDate(source.sentAt);
      const label = `self-${index}${date ? ` · ${date}` : ""}`;
      return (
        <span
          title={source.snippet || "past reply"}
          className={`${base} border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]`}
        >
          <Clock size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">{label}</span>
          <span className="max-w-[180px] truncate">
            {source.snippet || "past reply"}
          </span>
        </span>
      );
    }
  }
}

function formatShortDate(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length < 10) return "";
  // ISO is "YYYY-MM-DD..." — slice to month/day for a compact pill label.
  const m = iso.slice(5, 7).replace(/^0/, "");
  const d = iso.slice(8, 10).replace(/^0/, "");
  if (!m || !d) return "";
  return `${m}/${d}`;
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
