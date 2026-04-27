"use client";

import { useState } from "react";
import type { LinkifiedSegment } from "@/lib/agent/email/body-extract";

const COLLAPSE_THRESHOLD = 600;

export function EmailBody({
  segments,
  fallbackSnippet,
}: {
  segments: LinkifiedSegment[];
  fallbackSnippet: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalLen = segments.reduce((acc, s) => acc + s.value.length, 0);
  const isLong = totalLen > COLLAPSE_THRESHOLD;

  // Empty body fallback — fall back to the ingest-time snippet so the
  // detail page always shows *something*. Snippet is cleaner than a
  // blank panel and matches what L1 / L2 already see internally.
  if (totalLen === 0) {
    if (!fallbackSnippet) return null;
    return (
      <p className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
        {fallbackSnippet}
      </p>
    );
  }

  const visibleSegments = expanded || !isLong
    ? segments
    : truncateSegments(segments, COLLAPSE_THRESHOLD);

  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--foreground))]">
      <pre className="whitespace-pre-wrap font-sans leading-relaxed">
        {visibleSegments.map((seg, i) =>
          seg.kind === "link" ? (
            <a
              key={`l-${i}`}
              href={seg.value}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
            >
              {seg.value}
            </a>
          ) : (
            <span key={`t-${i}`}>{seg.value}</span>
          )
        )}
        {!expanded && isLong ? (
          <span className="text-[hsl(var(--muted-foreground))]">…</span>
        ) : null}
      </pre>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[12px] font-medium text-[hsl(var(--primary))] hover:underline"
        >
          {expanded ? "Show less" : "Show full email"}
        </button>
      ) : null}
    </div>
  );
}

function truncateSegments(
  segments: LinkifiedSegment[],
  limit: number
): LinkifiedSegment[] {
  const out: LinkifiedSegment[] = [];
  let used = 0;
  for (const seg of segments) {
    const remaining = limit - used;
    if (remaining <= 0) break;
    if (seg.value.length <= remaining) {
      out.push(seg);
      used += seg.value.length;
    } else {
      // Don't break a link mid-URL; if it's a link, drop it entirely
      // and stop. For plain text, slice at remaining length.
      if (seg.kind === "link") break;
      out.push({ kind: "text", value: seg.value.slice(0, remaining) });
      break;
    }
  }
  return out;
}
