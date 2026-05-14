"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  summarizeToolCalls,
  type ToolSummaryEvent,
} from "@/lib/utils/tool-call-summary";
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
        {items.map((it, i) =>
          it.kind === "narration" ? (
            <p
              key={`n-${i}`}
              className="whitespace-pre-wrap text-small italic text-[hsl(var(--muted-foreground))]"
            >
              {it.text}
            </p>
          ) : (
            <ToolCallCard
              key={`t-${it.event.id}`}
              toolName={it.event.toolName}
              status={it.event.status as ToolCallStatus}
              args={it.event.args}
              result={it.event.result}
              pendingId={it.event.pendingId}
              onConfirm={(d) =>
                it.event.pendingId &&
                onConfirmPending?.(it.event.pendingId, d)
              }
            />
          )
        )}
      </div>
    </div>
  );
}

function buildChipLabel({
  t,
  summary,
  isStreaming,
}: {
  t: ReturnType<typeof useTranslations>;
  summary: ReturnType<typeof summarizeToolCalls>;
  isStreaming: boolean;
}): string {
  const thinking = t("thinking_prefix");
  const sequence = summary.sequenceLabel ?? "";
  const annotations: string[] = [];

  if (summary.inFlightTool && isStreaming) {
    return `${thinking} ${sequence}…`;
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
    return `${thinking} ${sequence} (${annotations.join(", ")})`;
  }
  return `${thinking} ${sequence}`;
}
