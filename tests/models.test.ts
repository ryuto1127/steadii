import { describe, expect, it } from "vitest";
import {
  selectModel,
  estimateUsdCost,
  usdToCredits,
  type TaskType,
} from "@/lib/agent/models";

describe("selectModel routing", () => {
  it("routes chat and tool_call to mini", () => {
    expect(selectModel("chat")).toBe("gpt-5.4-mini");
    expect(selectModel("tool_call")).toBe("gpt-5.4-mini");
  });
  it("routes mistake_explain and syllabus_extract to full", () => {
    expect(selectModel("mistake_explain")).toBe("gpt-5.4");
    expect(selectModel("syllabus_extract")).toBe("gpt-5.4");
  });
  it("routes chat_title and tag_suggest to nano", () => {
    expect(selectModel("chat_title")).toBe("gpt-5.4-nano");
    expect(selectModel("tag_suggest")).toBe("gpt-5.4-nano");
  });
  it("covers every TaskType", () => {
    const tasks: TaskType[] = [
      "chat",
      "tool_call",
      "mistake_explain",
      "syllabus_extract",
      "chat_title",
      "tag_suggest",
    ];
    for (const t of tasks) {
      const model = selectModel(t);
      expect(["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]).toContain(model);
    }
  });
});

describe("credit accounting", () => {
  it("handles zero usage", () => {
    expect(estimateUsdCost("gpt-5.4-mini", { input: 0, output: 0, cached: 0 })).toBe(0);
    expect(usdToCredits(0)).toBe(0);
  });

  it("applies cached rate to cached input portion only", () => {
    const fullUncached = estimateUsdCost("gpt-5.4", {
      input: 1_000_000,
      output: 0,
      cached: 0,
    });
    const halfCached = estimateUsdCost("gpt-5.4", {
      input: 1_000_000,
      output: 0,
      cached: 500_000,
    });
    expect(halfCached).toBeLessThan(fullUncached);
  });

  it("usdToCredits floors at cent granularity", () => {
    expect(usdToCredits(0.019)).toBe(1);
    expect(usdToCredits(0.02)).toBe(2);
    expect(usdToCredits(1.0)).toBe(100);
  });
});
