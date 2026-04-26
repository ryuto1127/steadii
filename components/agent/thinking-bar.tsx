import {
  Sparkles,
  Mail,
  AlertTriangle,
  BookOpen,
  Calendar as CalendarIcon,
  GraduationCap,
} from "lucide-react";
import type {
  RetrievalProvenance,
  RetrievalProvenanceSource,
} from "@/lib/db/schema";

// Renders the "Thinking · complete" summary strip for a draft review.
// Input is the retrieval_provenance blob populated by the L2 deep pass
// (and Phase 7 W1, the multi-source fanout). When there's no retrieval
// (low-risk no_op, paused), we still render a minimal row so the UI
// doesn't shift.
//
// Per-source pills use distinct colours/icons to make the source legible
// at a glance — this is the visible half of the glass-box brand promise.
//
// Pre-W1 rows persisted only the email-only union variant. We normalize
// the shape on read so a row written before any of the W1 widening
// (mistake/syllabus/calendar pills, fanout counts) renders as a plain
// email-pill row instead of throwing on an unknown discriminator.
const MAX_VISIBLE_PILLS = 6;

const KNOWN_SOURCE_TYPES = new Set(["email", "mistake", "syllabus", "calendar"]);

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

export function ThinkingBar({
  provenance,
  riskTier,
}: {
  provenance: RetrievalProvenance | null;
  riskTier: "low" | "medium" | "high" | null;
}) {
  const sources = normalizeSources(provenance?.sources);
  const counts = provenance?.fanoutCounts ?? null;
  const binding = provenance?.classBinding ?? null;

  const tierLabel =
    riskTier === "high"
      ? "High risk"
      : riskTier === "medium"
      ? "Medium risk"
      : riskTier === "low"
      ? "Low risk"
      : "Classifying";

  // Headline counts. Prefer the richer fanout breakdown when present,
  // fall back to the legacy "N of M emails" line on pre-W1 rows.
  const headline = counts
    ? buildFanoutHeadline(counts)
    : buildLegacyHeadline(provenance);

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-small text-[hsl(var(--foreground))]">
        <Sparkles size={14} strokeWidth={1.75} className="text-[hsl(var(--primary))]" />
        <span className="font-medium">Thinking · complete</span>
        <span className="text-[hsl(var(--muted-foreground))]">·</span>
        <span className="text-[hsl(var(--muted-foreground))]">{tierLabel}</span>
        {headline ? (
          <>
            <span className="text-[hsl(var(--muted-foreground))]">·</span>
            <span className="text-[hsl(var(--muted-foreground))]">{headline}</span>
          </>
        ) : null}
      </div>

      {binding && binding.classId ? (
        <div className="mt-2 flex items-center gap-1.5 text-[12px]">
          <GraduationCap
            size={12}
            strokeWidth={1.75}
            className="text-[hsl(var(--primary))]"
          />
          <span className="text-[hsl(var(--muted-foreground))]">Bound to</span>
          <span
            className="font-medium text-[hsl(var(--foreground))]"
            title={formatBindingTitle(binding)}
          >
            {binding.className ?? "this class"}
            {binding.classCode ? ` (${binding.classCode})` : ""}
          </span>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.slice(0, MAX_VISIBLE_PILLS).map((s, i) => (
            <SourcePill key={pillKey(s, i)} source={s} index={i + 1} />
          ))}
          {sources.length > MAX_VISIBLE_PILLS ? (
            <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              {sources.length - MAX_VISIBLE_PILLS} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
    case "email":
      return (
        <span
          title={source.snippet}
          className={`${base} border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]`}
        >
          <Mail
            size={11}
            strokeWidth={1.75}
            className="text-[hsl(var(--muted-foreground))]"
          />
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
    case "mistake":
      return (
        <span
          title={source.snippet}
          className={`${base} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`}
        >
          <AlertTriangle size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            mistake-{index}
          </span>
          <span className="max-w-[180px] truncate">
            {source.snippet || "past mistake"}
          </span>
        </span>
      );
    case "syllabus":
      return (
        <span
          title={source.snippet}
          className={`${base} border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300`}
        >
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
        </span>
      );
    case "calendar":
      return (
        <span
          title={`${source.title} — ${source.start}${source.end ? ` → ${source.end}` : ""}`}
          className={`${base} border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300`}
        >
          <CalendarIcon size={11} strokeWidth={1.75} />
          <span className="font-mono text-[10px] tabular-nums">
            calendar-{index}
          </span>
          <span className="max-w-[180px] truncate">{source.title}</span>
        </span>
      );
  }
}

function pillKey(source: RetrievalProvenanceSource, index: number): string {
  return `${source.type}:${source.id}:${index}`;
}

// Render-safe wrapper: pre-W1 email rows always carried similarity, but
// JSONB drift or partial backfills can land us with a non-number here —
// we'd rather drop the percent than crash the row.
function formatSimilarityPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function formatBindingTitle(
  binding: NonNullable<RetrievalProvenance["classBinding"]>
): string {
  const method = binding.method ?? "binding";
  const c = binding.confidence;
  const conf =
    typeof c === "number" && Number.isFinite(c) ? c.toFixed(2) : "n/a";
  return `${method} (confidence ${conf})`;
}

function buildFanoutHeadline(counts: NonNullable<RetrievalProvenance["fanoutCounts"]>): string {
  const parts: string[] = [];
  if (counts.mistakes > 0) parts.push(`${counts.mistakes} mistake`);
  if (counts.syllabus > 0) parts.push(`${counts.syllabus} syllabus`);
  if (counts.calendar > 0) parts.push(`${counts.calendar} calendar`);
  if (counts.emails > 0) parts.push(`${counts.emails} email`);
  if (parts.length === 0) return "no fanout context";
  return parts.join(" · ");
}

function buildLegacyHeadline(
  provenance: RetrievalProvenance | null
): string | null {
  if (!provenance) return null;
  const returned = provenance.returned;
  const total = provenance.total_candidates;
  if (returned === 0) return null;
  return `${returned} of ${total} emails surfaced`;
}
