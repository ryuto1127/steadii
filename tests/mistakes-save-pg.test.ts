import { describe, expect, it } from "vitest";
import { buildMistakeMarkdownBody } from "@/lib/mistakes/build-body";

describe("buildMistakeMarkdownBody", () => {
  it("builds the Q+A body with H2 sections", () => {
    const out = buildMistakeMarkdownBody({
      userQuestion: "Why does ∫ x dx = x²/2 + C?",
      assistantExplanation: "Because the antiderivative...",
      imageUrls: [],
    });
    expect(out).toContain("## The problem");
    expect(out).toContain("## Step-by-step explanation");
    expect(out).toContain("∫ x dx = x²/2 + C");
    expect(out).toContain("Because the antiderivative");
  });

  it("emits image markdown blocks before the body", () => {
    const out = buildMistakeMarkdownBody({
      userQuestion: "Solve this.",
      assistantExplanation: "Step 1.",
      imageUrls: ["https://blob.example/a.png", "https://blob.example/b.png"],
    });
    const lines = out.split("\n\n");
    expect(lines[0]).toBe("![](https://blob.example/a.png)");
    expect(lines[1]).toBe("![](https://blob.example/b.png)");
  });

  it("preserves verbatim user text (no normalization)", () => {
    const verbatim = "  EXACT  Two  Spaces.  MixedCASE.  ";
    const out = buildMistakeMarkdownBody({
      userQuestion: verbatim,
      assistantExplanation: "",
      imageUrls: [],
    });
    expect(out).toContain(verbatim);
  });

  it("omits absent sections", () => {
    const onlyQ = buildMistakeMarkdownBody({
      userQuestion: "What is x?",
      assistantExplanation: "",
      imageUrls: [],
    });
    expect(onlyQ).toContain("## The problem");
    expect(onlyQ).not.toContain("Step-by-step");

    const onlyA = buildMistakeMarkdownBody({
      userQuestion: "",
      assistantExplanation: "Because…",
      imageUrls: [],
    });
    expect(onlyA).not.toContain("## The problem");
    expect(onlyA).toContain("## Step-by-step explanation");
  });
});
