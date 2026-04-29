import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Component-render testing infra (jsdom + @testing-library/react) isn't in
// tests/ yet, and the handoff explicitly said don't block this PR on a full
// test setup — snapshot the structure as text. These checks pin the contract
// so the choreography in the handoff doesn't silently rot.
const SRC = readFileSync(
  resolve(__dirname, "../components/landing/hero-animation.tsx"),
  "utf-8",
);

describe("HeroAnimation source contract", () => {
  it("respects prefers-reduced-motion via matchMedia", () => {
    expect(SRC).toContain("(prefers-reduced-motion: reduce)");
    expect(SRC).toContain("hero-animation-static");
  });

  it("renders all required choreography text", () => {
    expect(SRC).toContain("MAT223_Syllabus_Spring2026.pdf");
    expect(SRC).toContain("Extracting syllabus");
    expect(SRC).toContain("Math II");
    expect(SRC).toContain("Linear Algebra");
    expect(SRC).toContain("[Steadii]");
  });

  it("uses the locked class color taxonomy (#3B82F6) and amber accent", () => {
    expect(SRC).toContain("#3B82F6");
    expect(SRC).toContain("#F59E0B");
  });

  it("matches the existing 16:10 hero card aspect ratio", () => {
    expect(SRC).toContain("aspect-[16/10]");
  });

  it("declares all 10 choreography phases", () => {
    for (const phase of [
      "idle",
      "pdfDragging",
      "attached",
      "extracting",
      "extracted",
      "classesUp",
      "rowAdded",
      "calendar",
      "eventsFilled",
      "hold",
    ]) {
      expect(SRC).toContain(`"${phase}"`);
    }
  });

  it("loops in roughly 13 seconds (sum of step delays)", () => {
    // Pull the STEPS table out of the source and sum the delay fields.
    const match = SRC.match(/const STEPS[\s\S]*?\];/);
    expect(match, "STEPS table not found").toBeTruthy();
    const delays = [...(match?.[0] ?? "").matchAll(/delay:\s*(\d+)/g)].map(
      (m) => Number(m[1]),
    );
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBe(13000);
  });
});

describe("Marketing landing page wiring", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "../app/(marketing)/page.tsx"),
    "utf-8",
  );

  it("imports and renders HeroAnimation in place of the old <video>", () => {
    expect(PAGE_SRC).toContain(
      'import HeroAnimation from "@/components/landing/hero-animation"',
    );
    expect(PAGE_SRC).toContain("<HeroAnimation />");
    expect(PAGE_SRC).not.toContain("/demo/hero.webm");
    expect(PAGE_SRC).not.toContain("/demo/hero-poster.png");
  });
});
