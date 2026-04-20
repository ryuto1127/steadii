import { describe, expect, it } from "vitest";
import { __testing } from "@/components/chat/markdown-message";

const { normalizeMathDelimiters } = __testing;

describe("normalizeMathDelimiters — AMS-LaTeX → remark-math dollars", () => {
  it("leaves plain prose untouched", () => {
    const out = normalizeMathDelimiters("Look at the graph near the special x-values.");
    expect(out).toBe("Look at the graph near the special x-values.");
  });

  it("leaves existing $...$ and $$...$$ alone", () => {
    const input = "Inline $a+b$ and display $$\\int f(x)\\,dx$$";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("converts inline \\(x\\) to $x$", () => {
    const out = normalizeMathDelimiters("The limit \\(x \\to 2^-\\) is the key.");
    expect(out).toContain("$x \\to 2^-$");
    expect(out).not.toContain("\\(");
    expect(out).not.toContain("\\)");
  });

  it("converts display \\[...\\] to $$...$$ with surrounding blank lines", () => {
    const out = normalizeMathDelimiters(
      "So \\[ \\lim_{x\\to 2^-} f(x)\\text{ is unbounded} \\] is **true**."
    );
    expect(out).toContain("$$\\lim_{x\\to 2^-} f(x)\\text{ is unbounded}$$");
    expect(out).not.toContain("\\[");
    expect(out).not.toContain("\\]");
  });

  it("handles the real message from the Khan Academy limit problem", () => {
    const real =
      "### 1) As \\(x \\to 2^-\\) From the left side of \\(x=2\\), " +
      "the graph drops straight down. So \\[ \\lim_{x\\to 2^-} f(x)\\text{ is unbounded} \\] is **true**.";
    const out = normalizeMathDelimiters(real);
    expect(out).toMatch(/### 1\) As \$x \\to 2\^-\$ From the left side of \$x=2\$,/);
    expect(out).toContain("$$\\lim_{x\\to 2^-} f(x)\\text{ is unbounded}$$");
  });

  it("handles multi-line display math", () => {
    const input = "Step: \\[\na + b\n= c\n\\] done.";
    const out = normalizeMathDelimiters(input);
    // Inner expression keeps its newlines — KaTeX is tolerant of them.
    expect(out).toContain("$$a + b\n= c$$");
  });

  it("is idempotent on already-converted text", () => {
    const once = normalizeMathDelimiters("An \\(x\\) and \\[y\\].");
    const twice = normalizeMathDelimiters(once);
    expect(twice).toBe(once);
  });
});
