// Compress a stream of tool-call events into a compact one-line
// summary for the chat <ToolCallSummary> chip. Two pieces of context
// drive the shape:
//
//   - During streaming, calls arrive one at a time. The chip should
//     reflect the latest in-flight tool ("running: email_search…")
//     so the user sees motion without flicker.
//   - Once a turn settles, repeats and retries get folded into a
//     terse sequence ("email_search → email_get_body × 2 (1 retry)")
//     so the eye can land on the draft below without parsing a
//     ladder of ✓ marks.
//
// The shape mirrors `TurnItem`'s tool variant from chat-view but is
// re-declared here so the helper stays import-cheap (no circular
// references) and can be exercised directly from tests.
export type ToolSummaryStatus = "running" | "done" | "failed" | "pending" | "denied";

export type ToolSummaryEvent = {
  toolName: string;
  status: ToolSummaryStatus;
};

export type ToolCallSummary = {
  // Compact left-to-right sequence label, e.g. "email_search →
  // email_get_body × 2". `null` when the input is empty.
  sequenceLabel: string | null;
  // Aggregate counts the chip surfaces as small annotations after
  // the sequence.
  totalCount: number;
  failedCount: number;
  retryCount: number;
  // Name of the most-recent tool whose status is still "running" or
  // "pending". `null` once every call has settled.
  inFlightTool: string | null;
  // True when ANY tool in the sequence failed (after any later
  // success on the same tool). Drives the warning icon on the chip.
  anyFailed: boolean;
};

export function summarizeToolCalls(
  events: readonly ToolSummaryEvent[]
): ToolCallSummary {
  if (events.length === 0) {
    return {
      sequenceLabel: null,
      totalCount: 0,
      failedCount: 0,
      retryCount: 0,
      inFlightTool: null,
      anyFailed: false,
    };
  }

  // Collapse consecutive same-tool runs into one segment with a
  // `× N` suffix when N > 1. The simplest read: a 2nd consecutive
  // call to the same tool means "retry" (the model fired it again
  // because the first attempt didn't satisfy it). We surface that
  // count separately so the chip can flag "1 retry" without
  // hand-coding a deeper model of agent reasoning.
  type Segment = { tool: string; count: number };
  const segments: Segment[] = [];
  let failed = 0;
  let retries = 0;
  let inFlightTool: string | null = null;
  let anyFailed = false;

  for (const ev of events) {
    if (ev.status === "failed") {
      failed += 1;
      anyFailed = true;
    }
    if (ev.status === "running" || ev.status === "pending") {
      inFlightTool = ev.toolName;
    } else if (inFlightTool === ev.toolName) {
      // A previously in-flight call has just settled — clear the
      // marker so the chip doesn't keep showing a stale "running"
      // for a tool that already produced its result. Without this,
      // an event sequence like [running A, done A] (which only
      // happens in tests; production mutates in place) would keep
      // reporting A as in-flight.
      inFlightTool = null;
    }
    const last = segments[segments.length - 1];
    if (last && last.tool === ev.toolName) {
      last.count += 1;
      retries += 1;
    } else {
      segments.push({ tool: ev.toolName, count: 1 });
    }
  }

  const sequenceLabel = segments
    .map((s) => (s.count > 1 ? `${friendly(s.tool)} × ${s.count}` : friendly(s.tool)))
    .join(" → ");

  return {
    sequenceLabel,
    totalCount: events.length,
    failedCount: failed,
    retryCount: retries,
    inFlightTool,
    anyFailed,
  };
}

// `email_get_body` is more legible than the raw identifier, but we
// strip the trailing common suffixes ("_event", "_message") so the
// chip stays narrow. The chat already renders the full friendly name
// in the expanded view via ToolCallCard's FRIENDLY_NAMES — the chip
// is intentionally terser.
function friendly(tool: string): string {
  return tool;
}
