import {
  Sparkles,
  Mail,
  AlertTriangle,
  BookOpen,
  Calendar as CalendarIcon,
  Clock,
  GraduationCap,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
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

export async function ThinkingBar({
  provenance,
  riskTier,
}: {
  provenance: RetrievalProvenance | null;
  riskTier: "low" | "medium" | "high" | null;
}) {
  const t = await getTranslations("agent.thinking_bar");
  const tInbox = await getTranslations("inbox");
  const sources = normalizeSources(provenance?.sources);
  const counts = provenance?.fanoutCounts ?? null;
  const binding = provenance?.classBinding ?? null;

  const tierLabel =
    riskTier === "high"
      ? tInbox("tier_high")
      : riskTier === "medium"
      ? tInbox("tier_medium")
      : riskTier === "low"
      ? tInbox("tier_low")
      : tInbox("tier_classifying");

  // Headline counts. Prefer the richer fanout breakdown when present,
  // fall back to the legacy "N of M emails" line on pre-W1 rows.
  const headline = counts
    ? buildFanoutHeadline(counts, t)
    : buildLegacyHeadline(provenance, t);

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-small text-[hsl(var(--foreground))]">
        <Sparkles size={14} strokeWidth={1.75} className="text-[hsl(var(--primary))]" />
        <span className="font-medium">{t("thinking_complete")}</span>
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
          <span className="text-[hsl(var(--muted-foreground))]">{t("bound_to")}</span>
          <span
            className="font-medium text-[hsl(var(--foreground))]"
            title={formatBindingTitle(binding)}
          >
            {binding.className ?? t("this_class")}
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
    case "sender_history": {
      // engineer-38 — past reply Ryuto sent to the same sender. Compact
      // "self-N · 4/22" label keeps the pill row scannable on the
      // /how-your-agent-thinks debug page.
      const date = formatShortDateFromIso(source.sentAt);
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

function formatShortDateFromIso(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length < 10) return "";
  const m = iso.slice(5, 7).replace(/^0/, "");
  const d = iso.slice(8, 10).replace(/^0/, "");
  if (!m || !d) return "";
  return `${m}/${d}`;
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

function buildFanoutHeadline(
  counts: NonNullable<RetrievalProvenance["fanoutCounts"]>,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const parts: string[] = [];
  // engineer-38 — sender-history replaced the mistakes slot. Read either
  // shape for back-compat with rows persisted before the rename.
  const senderN = counts.senderHistory ?? 0;
  const mistakeN = counts.mistakes ?? 0;
  if (senderN > 0) parts.push(t("fanout_sender_history", { n: senderN }));
  if (mistakeN > 0) parts.push(t("fanout_mistake", { n: mistakeN }));
  if (counts.syllabus > 0) parts.push(t("fanout_syllabus", { n: counts.syllabus }));
  if (counts.calendar > 0) parts.push(t("fanout_calendar", { n: counts.calendar }));
  if (counts.emails > 0) parts.push(t("fanout_email", { n: counts.emails }));
  if (parts.length === 0) return t("fanout_none");
  return parts.join(" · ");
}

function buildLegacyHeadline(
  provenance: RetrievalProvenance | null,
  t: (key: string, values?: Record<string, string | number>) => string
): string | null {
  if (!provenance) return null;
  const returned = provenance.returned;
  const total = provenance.total_candidates;
  if (returned === 0) return null;
  return t("legacy_emails_surfaced", { returned, total });
}
