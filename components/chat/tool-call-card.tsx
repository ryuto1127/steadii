"use client";

import { useState } from "react";
import { ChevronRight, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ToolCallStatus = "running" | "done" | "failed" | "pending" | "denied";

type Props = {
  toolName: string;
  status: ToolCallStatus;
  args?: unknown;
  result?: unknown;
  pendingId?: string;
  onConfirm?: (decision: "approve" | "deny") => void;
};

const FRIENDLY_NAMES: Record<string, string> = {
  calendar_create_event: "Creating calendar event",
  calendar_update_event: "Updating calendar event",
  calendar_delete_event: "Deleting calendar event",
  calendar_list_events: "Reading calendar",
  notion_search_pages: "Searching Notion",
  notion_get_page: "Reading Notion page",
  notion_create_page: "Creating Notion page",
  notion_update_page: "Updating Notion page",
  notion_delete_page: "Deleting Notion page",
  notion_query_database: "Querying Notion database",
  notion_create_row: "Adding Notion row",
  notion_update_row: "Updating Notion row",
  syllabus_save: "Saving syllabus",
  syllabus_extract: "Extracting syllabus",
  read_syllabus_full_text: "Reading syllabus source",
  summarize_week: "Summarizing past week",
};

function friendlyName(tool: string): string {
  return FRIENDLY_NAMES[tool] ?? tool.replaceAll("_", " ");
}

function verbForCompleted(tool: string): string {
  if (tool.includes("delete")) return "Deleted";
  if (tool.includes("create") || tool.includes("save") || tool.includes("add")) return "Created";
  if (tool.includes("update")) return "Updated";
  if (tool.includes("query") || tool.includes("search") || tool.includes("list") || tool.includes("read") || tool.includes("get")) {
    return "Done";
  }
  return "Done";
}

export function ToolCallCard({
  toolName,
  status,
  args,
  result,
  pendingId,
  onConfirm,
}: Props) {
  const [expanded, setExpanded] = useState(status === "pending" || status === "running");

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

  const statusIcon =
    status === "running" ? (
      <span
        aria-hidden
        className="inline-block h-1.5 w-4 rounded-full bg-[hsl(var(--primary))]"
        style={{ animation: "steadii-pulse 1.2s ease-in-out infinite" }}
      />
    ) : status === "done" ? (
      <Check size={14} strokeWidth={1.5} className="text-[hsl(var(--primary))]" />
    ) : status === "failed" ? (
      <X size={14} strokeWidth={1.5} className="text-[hsl(var(--destructive))]" />
    ) : status === "denied" ? (
      <X size={14} strokeWidth={1.5} className="text-[hsl(var(--muted-foreground))]" />
    ) : (
      <AlertTriangle size={14} strokeWidth={1.5} className="text-[hsl(var(--primary))]" />
    );

  const fieldRows = summarizeFields(args);

  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
        aria-expanded={expanded}
      >
        <span
          aria-hidden
          className="text-[hsl(var(--primary))]"
        >
          ✦
        </span>
        <span className="flex-1 text-body">
          {status === "done"
            ? `${verbForCompleted(toolName)} — ${friendlyName(toolName)}`
            : status === "failed"
            ? `Failed — ${friendlyName(toolName)}`
            : status === "denied"
            ? `Denied — ${friendlyName(toolName)}`
            : friendlyName(toolName)}
        </span>
        {statusIcon}
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className={cn(
            "text-[hsl(var(--muted-foreground))] transition-default",
            expanded ? "rotate-90" : ""
          )}
        />
      </button>
      {expanded && fieldRows.length > 0 ? (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2 font-mono text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          {fieldRows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-2">
              <span aria-hidden className="text-[hsl(var(--muted-foreground))]">
                ▸
              </span>
              <span className="shrink-0 text-[hsl(var(--foreground))]">{row.key}:</span>
              <span className="min-w-0 flex-1 truncate">{row.value}</span>
            </div>
          ))}
          {status === "failed" && result ? (
            <div className="mt-2 rounded-sm bg-[hsl(var(--destructive)/0.08)] p-2 text-[hsl(var(--destructive))]">
              {formatResultError(result)}
            </div>
          ) : null}
        </div>
      ) : null}
      <style>{`
        @keyframes steadii-pulse {
          0%, 100% { opacity: 0.45; transform: scaleX(0.8); }
          50% { opacity: 1; transform: scaleX(1); }
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
            The agent wants to DELETE:
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
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.("approve")}
            className="inline-flex items-center rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            Confirm deletion
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
