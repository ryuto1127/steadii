"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  renderSequenceLabel,
  summarizeToolCalls,
  type ToolSummaryEvent,
} from "@/lib/utils/tool-call-summary";
import {
  toolLabelDone,
  type ToolLabelLocale,
} from "@/lib/utils/tool-friendly-labels";
import { ToolCallCard, type ToolCallStatus } from "./tool-call-card";

export type ToolCallSummaryEvent = ToolSummaryEvent & {
  id: string;
  args?: unknown;
  result?: unknown;
  pendingId?: string;
};

export type ToolCallSummaryItem =
  | { kind: "narration"; text: string }
  | { kind: "tool"; event: ToolCallSummaryEvent };

// Collapsed-by-default chip that summarizes a turn's tool activity in
// a single line. Click to expand into the existing inline view
// (narrations + per-tool ToolCallCard). The chip stays mounted across
// status updates so streaming reads as a smooth label change instead
// of a remount/flash.
export function ToolCallSummary({
  items,
  isStreaming = false,
  onConfirmPending,
}: {
  items: readonly ToolCallSummaryItem[];
  isStreaming?: boolean;
  onConfirmPending?: (
    pendingId: string,
    decision: "approve" | "deny"
  ) => void;
}) {
  const t = useTranslations("tool_call_summary");
  const locale = (useLocale() === "ja" ? "ja" : "en") as ToolLabelLocale;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const toolEvents = items.flatMap((it) =>
    it.kind === "tool" ? [it.event] : []
  );
  const summary = summarizeToolCalls(toolEvents);

  if (toolEvents.length === 0) {
    return (
      <div className="space-y-1">
        {items.map((it, i) =>
          it.kind === "narration" ? (
            <p
              key={`n-${i}`}
              className="whitespace-pre-wrap text-small italic text-[hsl(var(--muted-foreground))]"
            >
              {it.text}
            </p>
          ) : null
        )}
      </div>
    );
  }

  const hasPending = toolEvents.some((e) => e.status === "pending");
  // Pending (destructive-confirm) rows include interactive
  // approve/deny buttons that the user must reach without first
  // expanding a chip — auto-expand whenever any tool is awaiting
  // confirmation so the controls aren't trapped behind a toggle.
  const forceExpanded = hasPending;
  const isOpen = expanded || forceExpanded;

  const chipLabel = buildChipLabel({
    t,
    summary,
    isStreaming,
    locale,
  });

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => !forceExpanded && setExpanded((e) => !e)}
        aria-expanded={isOpen}
        aria-controls={detailsId}
        disabled={forceExpanded}
        className={cn(
          "group/summary flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-small text-[hsl(var(--muted-foreground))] transition-hover",
          !forceExpanded && "hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
        )}
      >
        <ChevronRight
          size={11}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "shrink-0 transition-default",
            isOpen && "rotate-90"
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            summary.anyFailed && "text-[hsl(var(--destructive))]"
          )}
        >
          {chipLabel}
        </span>
        {summary.anyFailed ? (
          <AlertTriangle
            size={11}
            strokeWidth={2}
            aria-hidden
            className="shrink-0 text-[hsl(var(--destructive))]"
          />
        ) : null}
        {summary.inFlightTool ? (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]"
            style={{ animation: "steadii-pulse 1.2s ease-in-out infinite" }}
          />
        ) : null}
      </button>
      <div
        id={detailsId}
        hidden={!isOpen}
        className={cn(
          "ml-3 space-y-1 border-l border-[hsl(var(--border))] pl-3",
          isOpen ? "block" : "hidden"
        )}
      >
        {(() => {
          // 2026-05-18 — collapse consecutive same-tool runs in the
          // expanded bullet list (e.g. 4× convert_timezone for 2 slots ×
          // 2 endpoints → one card with "× 4" badge). The chip-level
          // collapse already does this via summarizeToolCalls; this
          // mirrors the behavior so the expanded view doesn't repeat
          // identical-looking bullets. Args / result reflect the LAST
          // call in the run (final state); per-call breakdown can be
          // added later if a real need surfaces.
          type RenderItem =
            | { kind: "narration"; text: string }
            | {
                kind: "tool-run";
                toolName: string;
                lastEvent: (typeof items)[number] extends infer T
                  ? T extends { kind: "tool"; event: infer E }
                    ? E
                    : never
                  : never;
                count: number;
              };
          const grouped: RenderItem[] = [];
          for (const it of items) {
            if (it.kind === "narration") {
              grouped.push({ kind: "narration", text: it.text });
              continue;
            }
            const last = grouped[grouped.length - 1];
            if (
              last &&
              last.kind === "tool-run" &&
              last.toolName === it.event.toolName &&
              // Don't collapse a pending row into a finished run — the
              // user needs the pending row's confirm UI visibly distinct.
              it.event.status !== "pending" &&
              last.lastEvent.status !== "pending"
            ) {
              last.count += 1;
              last.lastEvent = it.event;
            } else {
              grouped.push({
                kind: "tool-run",
                toolName: it.event.toolName,
                lastEvent: it.event,
                count: 1,
              });
            }
          }
          return grouped.map((g, i) =>
            g.kind === "narration" ? (
              <p
                key={`n-${i}`}
                className="whitespace-pre-wrap text-small italic text-[hsl(var(--muted-foreground))]"
              >
                {g.text}
              </p>
            ) : (
              <ToolCallCard
                key={`t-${g.lastEvent.id}`}
                toolName={g.toolName}
                status={g.lastEvent.status as ToolCallStatus}
                args={g.lastEvent.args}
                result={g.lastEvent.result}
                pendingId={g.lastEvent.pendingId}
                count={g.count}
                onConfirm={(d) =>
                  g.lastEvent.pendingId &&
                  onConfirmPending?.(g.lastEvent.pendingId, d)
                }
              />
            )
          );
        })()}
      </div>
    </div>
  );
}

function buildChipLabel({
  t,
  summary,
  isStreaming,
  locale,
}: {
  t: ReturnType<typeof useTranslations>;
  summary: ReturnType<typeof summarizeToolCalls>;
  isStreaming: boolean;
  locale: ToolLabelLocale;
}): string {
  // 2026-05-14 — dropped the "Steadii の思考:" / "Steadii's thinking:"
  // prefix per Ryuto. The chip's visual treatment (muted color, small
  // type, expand-chevron icon, sub-indented detail rows on expand)
  // already signals "this is the agent's reasoning trace" — the prose
  // prefix was redundant and ate the horizontal budget the sequence
  // arrow chain actually needs. `thinking_prefix` translation key is
  // intentionally left in place (en.ts / ja.ts) in case we want to
  // bring it back behind a setting.
  const toLabel = (tool: string) => toolLabelDone(tool, locale);
  const sequence = renderSequenceLabel(summary.sequence, toLabel) ?? "";
  const annotations: string[] = [];

  if (summary.inFlightTool && isStreaming) {
    return `${sequence}…`;
  }

  if (summary.failedCount > 0) {
    annotations.push(
      t("failed_count", { n: summary.failedCount })
    );
  }
  if (summary.retryCount > 0) {
    annotations.push(
      t("retry_count", { n: summary.retryCount })
    );
  }

  if (annotations.length > 0) {
    return `${sequence} (${annotations.join(", ")})`;
  }
  return sequence;
}
