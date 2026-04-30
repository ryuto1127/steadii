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

// Each tool gets a present-progressive label (running) and a past-tense
// label (done) so the chat row reads like a sentence: "Deleting calendar
// event" while the request is in flight, then "Deleted calendar event"
// once it lands. The bug 2026-04-30 ("delete results render as a black
// box") was the absence of a done-state label — the running label hung
// around even after the tool finished.
type ToolLabels = { running: string; done: string };

const FRIENDLY_NAMES: Record<string, ToolLabels> = {
  calendar_create_event: { running: "Creating calendar event", done: "Calendar event created" },
  calendar_update_event: { running: "Updating calendar event", done: "Calendar event updated" },
  calendar_delete_event: { running: "Deleting calendar event", done: "Calendar event deleted" },
  calendar_list_events: { running: "Reading calendar", done: "Read calendar" },
  notion_search_pages: { running: "Searching Notion", done: "Searched Notion" },
  notion_get_page: { running: "Reading Notion page", done: "Read Notion page" },
  notion_create_page: { running: "Creating Notion page", done: "Notion page created" },
  notion_update_page: { running: "Updating Notion page", done: "Notion page updated" },
  notion_delete_page: { running: "Deleting Notion page", done: "Notion page deleted" },
  notion_query_database: { running: "Querying Notion database", done: "Queried Notion database" },
  notion_create_row: { running: "Adding Notion row", done: "Notion row added" },
  notion_update_row: { running: "Updating Notion row", done: "Notion row updated" },
  syllabus_save: { running: "Saving syllabus", done: "Syllabus saved" },
  syllabus_extract: { running: "Extracting syllabus", done: "Syllabus extracted" },
  read_syllabus_full_text: { running: "Reading syllabus source", done: "Read syllabus source" },
  summarize_week: { running: "Summarizing past week", done: "Summarized past week" },
};

function friendlyName(tool: string, status: ToolCallStatus): string {
  const labels = FRIENDLY_NAMES[tool];
  if (labels) {
    return status === "done" ? labels.done : labels.running;
  }
  // Fallback for tools we haven't mapped: replace underscores so
  // `tasks_complete` reads as "tasks complete" rather than the raw
  // identifier. Not great, but the registry covers the common cases.
  return tool.replaceAll("_", " ");
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
          {friendlyName(toolName, status)}
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
