import { describe, it, expect } from "vitest";
import {
  summarizeToolCalls,
  type ToolSummaryEvent,
} from "@/lib/utils/tool-call-summary";

describe("summarizeToolCalls", () => {
  it("returns a neutral empty summary for an empty event list", () => {
    const summary = summarizeToolCalls([]);
    expect(summary).toEqual({
      sequenceLabel: null,
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
    expect(s.sequenceLabel).toBe("email_search");
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
    expect(summarizeToolCalls(events).sequenceLabel).toBe(
      "email_search → email_get_body"
    );
  });

  it("collapses consecutive same-tool runs with × N and reports retry count", () => {
    const events: ToolSummaryEvent[] = [
      { toolName: "email_search", status: "done" },
      { toolName: "email_get_body", status: "failed" },
      { toolName: "email_get_body", status: "done" },
    ];
    const s = summarizeToolCalls(events);
    expect(s.sequenceLabel).toBe("email_search → email_get_body × 2");
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
    expect(s.sequenceLabel).toBe("x × 3");
    expect(s.retryCount).toBe(2);
  });
});
