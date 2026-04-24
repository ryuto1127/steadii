import { Sparkles } from "lucide-react";
import type { RetrievalProvenance } from "@/lib/db/schema";

// Renders the "Thinking · complete" summary strip for a draft review.
// Input is the retrieval_provenance blob populated by the L2 deep pass.
// When there's no retrieval (medium-risk, low-risk, paused), we still
// render a minimal row so the UI doesn't shift.
export function ThinkingBar({
  provenance,
  riskTier,
}: {
  provenance: RetrievalProvenance | null;
  riskTier: "low" | "medium" | "high" | null;
}) {
  const returned = provenance?.returned ?? 0;
  const total = provenance?.total_candidates ?? 0;
  const sources = provenance?.sources ?? [];

  const tierLabel =
    riskTier === "high"
      ? "High risk"
      : riskTier === "medium"
      ? "Medium risk"
      : riskTier === "low"
      ? "Low risk"
      : "Classifying";

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
      <div className="flex items-center gap-2 text-small text-[hsl(var(--foreground))]">
        <Sparkles size={14} strokeWidth={1.75} className="text-[hsl(var(--primary))]" />
        <span className="font-medium">Thinking · complete</span>
        <span className="text-[hsl(var(--muted-foreground))]">·</span>
        <span className="text-[hsl(var(--muted-foreground))]">{tierLabel}</span>
        {returned > 0 ? (
          <>
            <span className="text-[hsl(var(--muted-foreground))]">·</span>
            <span className="text-[hsl(var(--muted-foreground))]">
              {returned} of {total} emails surfaced
            </span>
          </>
        ) : null}
      </div>
      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.slice(0, 3).map((s) => (
            <span
              key={s.id}
              title={s.snippet}
              className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))]"
            >
              <span className="font-mono tabular-nums">
                {(s.similarity * 100).toFixed(0)}%
              </span>
              <span className="max-w-[200px] truncate">{s.snippet || "email"}</span>
            </span>
          ))}
          {sources.length > 3 ? (
            <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              {sources.length - 3} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
