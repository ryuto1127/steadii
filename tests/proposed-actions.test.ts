import { describe, it, expect } from "vitest";
import { parseProposedActions } from "@/components/chat/proposed-actions";

describe("parseProposedActions", () => {
  it("returns the content unchanged when no block is present", () => {
    const out = parseProposedActions("Hello world.\nNothing to suggest.");
    expect(out.actions).toEqual([]);
    expect(out.body).toBe("Hello world.\nNothing to suggest.");
  });

  it("extracts a trailing block and strips it from the body", () => {
    const content = `5/16 のクラスは MAT223 と PSY101 です。

Proposed actions:
- [calendar_create_event] 5/16 欠席予定を追加
- [tasks_create] 5/16 欠席対応のタスクを追加`;
    const out = parseProposedActions(content);
    expect(out.actions).toEqual([
      {
        toolName: "calendar_create_event",
        label: "5/16 欠席予定を追加",
      },
      {
        toolName: "tasks_create",
        label: "5/16 欠席対応のタスクを追加",
      },
    ]);
    expect(out.body).toBe("5/16 のクラスは MAT223 と PSY101 です。");
  });

  it("accepts • and * as bullet markers", () => {
    const content = `Body.

Proposed actions:
• [a_tool] one
* [b_tool] two`;
    const out = parseProposedActions(content);
    expect(out.actions).toHaveLength(2);
    expect(out.actions[0].toolName).toBe("a_tool");
    expect(out.actions[1].toolName).toBe("b_tool");
  });

  it("ignores partial/incomplete blocks while streaming", () => {
    // Mid-stream: header has arrived but no bullet yet. Don't strip the
    // body or render pills — user will see the header momentarily, then
    // pills materialise when at least one bullet validates.
    const content = "Body.\n\nProposed actions:\n";
    const out = parseProposedActions(content);
    expect(out.actions).toEqual([]);
    expect(out.body).toBe(content);
  });

  it("bails out when the header is followed by non-bullet text", () => {
    // Defensive: if the model writes "Proposed actions: foo" inline (no
    // bullets) we don't want to swallow `foo` into the body.
    const content = "Body.\n\nProposed actions:\nMaybe later.";
    const out = parseProposedActions(content);
    expect(out.actions).toEqual([]);
    expect(out.body).toBe(content);
  });

  it("uses the LAST 'Proposed actions:' header when content mentions the phrase earlier", () => {
    const content = `I'll mention proposed actions inline. Here are mine.

Proposed actions:
- [tool_x] do x`;
    const out = parseProposedActions(content);
    expect(out.actions).toEqual([{ toolName: "tool_x", label: "do x" }]);
    expect(out.body.includes("inline")).toBe(true);
  });
});
