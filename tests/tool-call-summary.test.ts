import { describe, it, expect } from "vitest";
import {
  renderSequenceLabel,
  summarizeToolCalls,
  type ToolSummaryEvent,
} from "@/lib/utils/tool-call-summary";

// `summarizeToolCalls` is the pure aggregator: it groups consecutive
// same-tool runs into segments + counts retries / failures / in-flight.
// `renderSequenceLabel` is the presentation seam — callers pass a
// locale-aware label resolver. Splitting the two lets JA and EN
// surfaces share the same aggregation logic without duplicating the
// arrow-joining and × count math. 2026-05-14 — split out when raw
// tool IDs leaked into the chip during Ryuto's dogfood.
const identity = (s: string) => s;

describe("summarizeToolCalls", () => {
  it("returns a neutral empty summary for an empty event list", () => {
    const summary = summarizeToolCalls([]);
    expect(summary).toEqual({
      sequence: [],
      totalCount: 0,
      failedCount: 0,
      retryCount: 0,
      inFlightTool: null,
      anyFailed: false,
    });
  });

  it("renders a single tool call as a plain label", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "done" },
    ];
    const s = summarizeToolCalls(events);
    expect(renderSequenceLabel(s.sequence, identity)).toBe("email_search");
    expect(s.totalCount).toBe(1);
    expect(s.retryCount).toBe(0);
    expect(s.failedCount).toBe(0);
    expect(s.anyFailed).toBe(false);
    expect(s.inFlightTool).toBeNull();
  });

  it("joins distinct consecutive tools with an arrow", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "done" },
      { toolName: "email_get_body", status: "done" },
    ];
    expect(
      renderSequenceLabel(summarizeToolCalls(events).sequence, identity)
    ).toBe("email_search → email_get_body");
  });

  it("collapses consecutive same-tool runs with × N and reports retry count", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "done" },
      { toolName: "email_get_body", status: "failed" },
      { toolName: "email_get_body", status: "done" },
    ];
    const s = summarizeToolCalls(events);
    expect(renderSequenceLabel(s.sequence, identity)).toBe(
      "email_search → email_get_body × 2"
    );
    expect(s.retryCount).toBe(1);
    expect(s.failedCount).toBe(1);
    expect(s.anyFailed).toBe(true);
    expect(s.totalCount).toBe(3);
  });

  it("flags the in-flight tool while at least one call is still running", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "done" },
      { toolName: "email_get_body", status: "running" },
    ];
    const s = summarizeToolCalls(events);
    expect(s.inFlightTool).toBe("email_get_body");
  });

  it("clears the in-flight marker once the trailing call settles", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "running" },
      { toolName: "email_search", status: "done" },
    ];
    expect(summarizeToolCalls(events).inFlightTool).toBeNull();
  });

  it("treats a pending tool (awaiting confirmation) as in-flight", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "calendar_delete_event", status: "pending" },
    ];
    expect(summarizeToolCalls(events).inFlightTool).toBe(
      "calendar_delete_event"
    );
  });

  it("counts every failure, even when a later same-tool retry succeeds", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "x", status: "failed" },
      { toolName: "x", status: "failed" },
      { toolName: "x", status: "done" },
    ];
    const s = summarizeToolCalls(events);
    expect(s.failedCount).toBe(2);
    expect(s.anyFailed).toBe(true);
    expect(renderSequenceLabel(s.sequence, identity)).toBe("x × 3");
    expect(s.retryCount).toBe(2);
  });
});

describe("renderSequenceLabel", () => {
  it("returns null for an empty segment list", () => {
    expect(renderSequenceLabel([], identity)).toBeNull();
  });

  it("uses the resolver for friendly labels", () => {
    const segments = [
      { tool: "email_search", count: 1 },
      { tool: "email_get_body", count: 2 },
    ];
    const ja: Record<string, string> = {
      email_search: "メールを探す",
      email_get_body: "本文を確認",
    };
    expect(renderSequenceLabel(segments, (t) => ja[t] ?? t)).toBe(
      "メールを探す → 本文を確認 × 2"
    );
  });

  it("falls back gracefully when the resolver returns the raw id", () => {
    const segments = [{ tool: "unknown_tool", count: 1 }];
    expect(renderSequenceLabel(segments, identity)).toBe("unknown_tool");
  });
});
