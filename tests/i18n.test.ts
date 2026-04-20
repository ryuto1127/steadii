import { describe, expect, it } from "vitest";
import {
  detectLocaleFromAcceptLanguage,
  defaultLocale,
  isLocale,
  locales,
} from "@/lib/i18n/config";
import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

describe("locale detection", () => {
  it("falls back to default when header missing", () => {
    expect(detectLocaleFromAcceptLanguage(null)).toBe(defaultLocale);
  });

  it("picks Japanese when ja is preferred", () => {
    expect(detectLocaleFromAcceptLanguage("ja,en-US;q=0.8,en;q=0.5")).toBe("ja");
  });

  it("picks English for en-US", () => {
    expect(detectLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("falls back when header has no supported locale", () => {
    expect(detectLocaleFromAcceptLanguage("fr-FR,fr;q=0.9")).toBe(defaultLocale);
  });

  it("isLocale narrows correctly", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("exposes both en and ja", () => {
    expect([...locales].sort()).toEqual(["en", "ja"]);
  });
});

describe("translation shape parity", () => {
  const walk = (obj: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" && v !== null
        ? walk(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    );

  it("ja has the same keys as en", () => {
    const enKeys = walk(en as unknown as Record<string, unknown>).sort();
    const jaKeys = walk(ja as unknown as Record<string, unknown>).sort();
    expect(jaKeys).toEqual(enKeys);
  });
});
