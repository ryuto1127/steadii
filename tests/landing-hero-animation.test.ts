import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

// Component-render testing infra (jsdom + @testing-library/react) isn't in
// tests/ yet — snapshot the structure as text. These checks pin the
// landing-demo-refresh contract: command palette → typed query → Type B
// variant pre-brief card. If the choreography changes, update both the
// component and this test together.
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
    expect(SRC).toContain('useTranslations("landing.hero_animation")');
    // The visible labels are sourced from i18n. Verify the component pulls
    // the new Wave-2-aligned keys, and verify both locales cover the same
    // structural pieces.
    expect(SRC).toContain('t("palette_placeholder")');
    expect(SRC).toContain('t("palette_typing_query")');
    expect(SRC).toContain('t("card_title")');
    expect(SRC).toContain('t("card_action_mark_reviewed")');
    expect(en.landing.hero_animation.palette_placeholder).toContain("Tell");
    expect(ja.landing.hero_animation.palette_placeholder).toContain("頼");
    expect(en.landing.hero_animation.card_title).toContain("Tanaka");
    expect(ja.landing.hero_animation.card_title).toContain("田中");
  });

  it("uses the locked accent palette (#3B82F6 class color, #F59E0B amber)", () => {
    expect(SRC).toContain("#3B82F6");
    expect(SRC).toContain("#F59E0B");
  });

  it("matches the existing 16:10 hero card aspect ratio", () => {
    expect(SRC).toContain("aspect-[16/10]");
  });

  it("declares all 7 choreography phases", () => {
    for (const phase of [
      "idle",
      "typing",
      "send",
      "clear",
      "cardIn",
      "hold",
      "fadeOut",
    ]) {
      expect(SRC).toContain(`"${phase}"`);
    }
  });

  it("loops in 13 seconds (sum of step delays)", () => {
    const match = SRC.match(/const STEPS[\s\S]*?\];/);
    expect(match, "STEPS table not found").toBeTruthy();
    const delays = [...(match?.[0] ?? "").matchAll(/delay:\s*(\d+)/g)].map(
      (m) => Number(m[1]),
    );
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBe(13000);
  });

  it("renders a Type B informational queue card (Wave 3.1 pre-brief shape)", () => {
    // The pre-brief card is the queue archetype B "informational" variant
    // (see project_wave_2_home_design.md). The data-* hooks mirror the real
    // queue-card.tsx contract so the demo and prod surface stay aligned.
    expect(SRC).toContain('data-archetype="B"');
    expect(SRC).toContain('data-mode="informational"');
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
