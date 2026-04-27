import { describe, expect, it } from "vitest";
import {
  parseGeneratorOutput,
  isAllowedProactiveTool,
  shouldGenerateActionsFor,
} from "@/lib/agent/proactive/proposal-parser";

describe("parseGeneratorOutput", () => {
  it("parses a valid action array", () => {
    const raw = JSON.stringify({
      actions: [
        {
          key: "email_prof",
          label: "📧 Email professor",
          description: "Draft a quick reply",
          tool: "email_professor",
          payload: { classId: "c1" },
        },
        {
          key: "dismiss",
          label: "Dismiss",
          description: "Hide for 24h",
          tool: "dismiss",
          payload: {},
        },
      ],
    });
    const result = parseGeneratorOutput(raw);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].tool).toBe("email_professor");
  });

  it("returns null for malformed JSON", () => {
    expect(parseGeneratorOutput("not-json")).toBeNull();
  });

  it("filters out items with disallowed tools", () => {
    const raw = JSON.stringify({
      actions: [
        {
          key: "made_up",
          label: "Do magic",
          description: "x",
          tool: "made_up_tool",
          payload: {},
        },
        {
          key: "ok",
          label: "OK",
          description: "x",
          tool: "chat_followup",
          payload: {},
        },
        {
          key: "dismiss",
          label: "Dismiss",
          description: "x",
          tool: "dismiss",
          payload: {},
        },
      ],
    });
    const result = parseGeneratorOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.every((a) => (a.tool as string) !== "made_up_tool")).toBe(
      true
    );
  });

  it("returns null when fewer than 2 valid items remain", () => {
    const raw = JSON.stringify({ actions: [] });
    expect(parseGeneratorOutput(raw)).toBeNull();
  });
});

describe("isAllowedProactiveTool", () => {
  it("accepts each D9 tool", () => {
    for (const t of [
      "email_professor",
      "reschedule_event",
      "delete_event",
      "create_task",
      "chat_followup",
      "add_mistake_note",
      "link_existing",
      "add_anyway",
      "dismiss",
    ]) {
      expect(isAllowedProactiveTool(t)).toBe(true);
    }
  });
  it("rejects unknown tools", () => {
    expect(isAllowedProactiveTool("delete_user")).toBe(false);
    expect(isAllowedProactiveTool("")).toBe(false);
  });
});

describe("shouldGenerateActionsFor", () => {
  it("skips auto_action_log (informational)", () => {
    expect(shouldGenerateActionsFor("auto_action_log")).toBe(false);
  });
  it("runs for the rule-detected types", () => {
    expect(shouldGenerateActionsFor("time_conflict")).toBe(true);
    expect(shouldGenerateActionsFor("exam_conflict")).toBe(true);
    expect(shouldGenerateActionsFor("deadline_during_travel")).toBe(true);
    expect(shouldGenerateActionsFor("exam_under_prepared")).toBe(true);
    expect(shouldGenerateActionsFor("workload_over_capacity")).toBe(true);
    expect(shouldGenerateActionsFor("syllabus_calendar_ambiguity")).toBe(true);
  });
});
