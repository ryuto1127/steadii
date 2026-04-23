import { describe, expect, it } from "vitest";
import {
  selectModel,
  estimateUsdCost,
  usdToCredits,
  taskTypeMetersCredits,
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
  it("routes email_classify_risk to mini, deep + draft to full", () => {
    expect(selectModel("email_classify_risk")).toBe("gpt-5.4-mini");
    expect(selectModel("email_classify_deep")).toBe("gpt-5.4");
    expect(selectModel("email_draft")).toBe("gpt-5.4");
  });
  it("routes email_embed to text-embedding-3-small", () => {
    expect(selectModel("email_embed")).toBe("text-embedding-3-small");
  });
  it("covers every TaskType", () => {
    const tasks: TaskType[] = [
      "chat",
      "tool_call",
      "mistake_explain",
      "syllabus_extract",
      "chat_title",
      "tag_suggest",
      "email_classify_risk",
      "email_classify_deep",
      "email_draft",
      "email_embed",
    ];
    for (const t of tasks) {
      const model = selectModel(t);
      expect([
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "text-embedding-3-small",
      ]).toContain(model);
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

  it("taskTypeMetersCredits: metered set includes agent L2 + embed", () => {
    expect(taskTypeMetersCredits("mistake_explain")).toBe(true);
    expect(taskTypeMetersCredits("syllabus_extract")).toBe(true);
    expect(taskTypeMetersCredits("email_classify_risk")).toBe(true);
    expect(taskTypeMetersCredits("email_classify_deep")).toBe(true);
    expect(taskTypeMetersCredits("email_draft")).toBe(true);
    expect(taskTypeMetersCredits("email_embed")).toBe(true);
    // Chat is rate-limited by plan tier, not credit-gated.
    expect(taskTypeMetersCredits("chat")).toBe(false);
    expect(taskTypeMetersCredits("tool_call")).toBe(false);
    // Meta (titles/tags) is negligible nano work — unmetered.
    expect(taskTypeMetersCredits("chat_title")).toBe(false);
    expect(taskTypeMetersCredits("tag_suggest")).toBe(false);
  });

  it("usdToCredits floors at half-cent granularity (1 credit = $0.005)", () => {
    // $0.019 * 200 = 3.8 → floor = 3
    expect(usdToCredits(0.019)).toBe(3);
    // $0.02 * 200 = 4
    expect(usdToCredits(0.02)).toBe(4);
    // $1.00 * 200 = 200
    expect(usdToCredits(1.0)).toBe(200);
    // $0.001 * 200 = 0.2 → floor = 0
    expect(usdToCredits(0.001)).toBe(0);
    // $0.005 * 200 = 1
    expect(usdToCredits(0.005)).toBe(1);
  });
});
