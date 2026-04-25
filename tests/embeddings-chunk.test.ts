import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/embeddings/chunk";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const out = chunkText("Hello world");
    expect(out).toEqual([{ index: 0, text: "Hello world" }]);
  });

  it("preserves verbatim content (no lowercase, no whitespace squashing inside paragraphs)", () => {
    const t = "Q1: Find ∫ x dx.\n\n  Two   spaces stay.\n\nMixedCase Words.";
    const [chunk] = chunkText(t);
    expect(chunk.text).toContain("∫ x dx");
    expect(chunk.text).toContain("MixedCase Words");
    expect(chunk.text).toContain("Two   spaces stay");
  });

  it("splits on paragraph boundaries when over the soft target", () => {
    const para = "x".repeat(1500);
    const t = `${para}\n\n${para}\n\n${para}`;
    const out = chunkText(t);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].index).toBe(0);
    expect(out[1].index).toBe(1);
  });

  it("hard-splits a runaway paragraph that has no breaks", () => {
    const t = "y".repeat(6000);
    const out = chunkText(t);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.text.length).toBeLessThanOrEqual(2400);
    }
  });
});
