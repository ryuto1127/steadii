import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

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

  it("wires choreography text via i18n (no hardcoded EN/JP mix on the page)", () => {
    // The file name is universal — kept literal in the source.
    expect(SRC).toContain("MAT223_Syllabus_Spring2026.pdf");
    // The visible labels are now sourced from i18n. Verify the component
    // pulls from the expected keys, and verify the keys' values cover both
    // locales with the syllabus class identity. The marketing landing
    // surface must be 100% locale-aware — no JP strings rendering on the
    // EN landing or vice versa.
    expect(SRC).toContain('useTranslations("landing.hero_animation")');
    expect(SRC).toContain('t("extracting")');
    expect(SRC).toContain('t.rich("imported_summary"');
    expect(en.landing.hero_animation.extracting).toContain("Extracting");
    expect(ja.landing.hero_animation.extracting).toContain("シラバス");
    expect(en.landing.hero_animation.imported_summary).toContain("Math II");
    expect(ja.landing.hero_animation.imported_summary).toContain("Math II");
    // Fix 4 (2026-04-29) dropped the visible "[Steadii]" prefix from
    // syllabus-imported events; the demo mirrors that. Provenance still
    // lives in event.description ("Imported from Steadii syllabus …").
    expect(SRC).not.toContain("[Steadii]");
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
