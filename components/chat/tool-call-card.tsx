"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  toolLabel,
  type ToolLabelLocale,
} from "@/lib/utils/tool-friendly-labels";

export type ToolCallStatus = "running" | "done" | "failed" | "pending" | "denied";

type Props = {
  toolName: string;
  status: ToolCallStatus;
  args?: unknown;
  result?: unknown;
  pendingId?: string;
  onConfirm?: (decision: "approve" | "deny") => void;
};

// 2026-05-14 — friendly-label mapping moved to lib/utils/tool-
// friendly-labels.ts so the card AND the collapsed chip share the same
// JA/EN labels. Before this, the chip showed raw tool IDs (`save_
// working_hours`) to JA users while the card was English-only — both
// broken in different ways.
function friendlyName(
  tool: string,
  status: ToolCallStatus,
  locale: ToolLabelLocale
): string {
  const labels = toolLabel(tool, locale);
  return status === "done" ? labels.done : labels.running;
}

export function ToolCallCard({
  toolName,
  status,
  args,
  result,
  pendingId,
  onConfirm,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const locale = (useLocale() === "ja" ? "ja" : "en") as ToolLabelLocale;

  const isDestructivePending = status === "pending" && toolName.includes("delete");

  if (isDestructivePending) {
    return (
      <DestructiveConfirm
        toolName={toolName}
        args={args}
        pendingId={pendingId}
        onConfirm={onConfirm}
      />
    );
  }

  const fieldRows = summarizeFields(args);
  const hasDetail = fieldRows.length > 0 || (status === "failed" && !!result);

  const dot =
    status === "running" ? (
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]"
        style={{ animation: "steadii-pulse 1.2s ease-in-out infinite" }}
      />
    ) : status === "done" ? (
      <Check
        size={11}
        strokeWidth={2}
        className="text-[hsl(var(--muted-foreground))]"
      />
    ) : status === "failed" ? (
      <X size={11} strokeWidth={2} className="text-[hsl(var(--destructive))]" />
    ) : status === "denied" ? (
      <X
        size={11}
        strokeWidth={2}
        className="text-[hsl(var(--muted-foreground))]"
      />
    ) : (
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]"
      />
    );

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((e) => !e)}
        className={cn(
          "flex w-full items-center gap-2 py-0.5 text-left text-small text-[hsl(var(--muted-foreground))] transition-hover",
          hasDetail
            ? "cursor-pointer hover:text-[hsl(var(--foreground))]"
            : "cursor-default"
        )}
        aria-expanded={expanded}
      >
        <span className="flex h-3 w-3 shrink-0 items-center justify-center">
          {dot}
        </span>
        <span
          className={cn(
            "flex-1 truncate",
            status === "failed" && "text-[hsl(var(--destructive))]"
          )}
        >
          {friendlyName(toolName, status, locale)}
          {status === "failed" ? " — failed" : null}
        </span>
        {hasDetail ? (
          <ChevronRight
            size={11}
            strokeWidth={1.5}
            className={cn(
              "shrink-0 opacity-0 transition-default group-hover:opacity-60",
              expanded && "rotate-90 opacity-60"
            )}
          />
        ) : null}
      </button>
      {expanded && hasDetail ? (
        <div className="ml-5 border-l border-[hsl(var(--border))] pl-3 py-1 font-mono text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          {fieldRows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-2">
              <span className="shrink-0">{row.key}:</span>
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
                {row.value}
              </span>
            </div>
          ))}
          {status === "failed" && result ? (
            <div className="mt-1 text-[hsl(var(--destructive))]">
              {formatResultError(result)}
            </div>
          ) : null}
        </div>
      ) : null}
      <style>{`
        @keyframes steadii-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function DestructiveConfirm({
  toolName,
  args,
  pendingId,
  onConfirm,
}: {
  toolName: string;
  args: unknown;
  pendingId?: string;
  onConfirm?: (decision: "approve" | "deny") => void;
}) {
  const t = useTranslations("tool_call_card");
  const target = describeDestructiveTarget(toolName, args);
  return (
    <div className="rounded-md border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.05)] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          strokeWidth={1.5}
          className="mt-1 shrink-0 text-[hsl(var(--destructive))]"
        />
        <div className="flex-1">
          <p className="text-body font-medium text-[hsl(var(--foreground))]">
            {t("delete_target_label")}
          </p>
          <p className="mt-1 font-mono text-small text-[hsl(var(--foreground))]">
            &ldquo;{target.name}&rdquo;
            <span className="ml-1 text-[hsl(var(--muted-foreground))]">
              ({target.kind})
            </span>
          </p>
        </div>
      </div>
      {pendingId ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onConfirm?.("deny")}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.("approve")}
            className="inline-flex items-center rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {t("confirm_delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function summarizeFields(args: unknown): Array<{ key: string; value: string }> {
  if (!args || typeof args !== "object") return [];
  const rows: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      rows.push({ key: prettyKey(k), value: v });
    } else if (typeof v === "number" || typeof v === "boolean") {
      rows.push({ key: prettyKey(k), value: String(v) });
    } else {
      const s = JSON.stringify(v);
      rows.push({ key: prettyKey(k), value: s.length > 80 ? s.slice(0, 77) + "…" : s });
    }
  }
  return rows.slice(0, 6);
}

function prettyKey(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (m) => m.toUpperCase());
}

function formatResultError(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "error" in result) {
    const e = (result as { error: unknown }).error;
    if (typeof e === "string") return e;
  }
  return "Tool execution failed.";
}

function describeDestructiveTarget(
  toolName: string,
  args: unknown
): { kind: string; name: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  if (toolName === "notion_delete_page") {
    return {
      kind: "Notion page",
      name: String(a.title ?? a.pageId ?? "Unknown page"),
    };
  }
  if (toolName === "calendar_delete_event") {
    return {
      kind: "Calendar event",
      name: String(a.summary ?? a.eventId ?? "Unknown event"),
    };
  }
  return { kind: "resource", name: String(a.title ?? a.id ?? "Unknown") };
}
