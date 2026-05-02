import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

/**
 * Locale parity test. Complements `i18n.test.ts` (which already enforces
 * structural key parity) with VALUE-level checks:
 *
 *  - Hard fail: any leaf is empty / whitespace-only.
 *  - Hard fail: placeholder set ({name}, {0}, etc.) differs between en/ja
 *    at the same key path.
 *  - Soft warn: cross-locale leak — Latin-only string in JA leaf, or
 *    string containing CJK in EN leaf. Logged via console.warn so the
 *    sweep step in polish-19 can catch them, but the test still passes
 *    so brand-name leaves and intentional Latin in JA (model IDs etc.)
 *    don't break CI.
 */

const PLACEHOLDER_RE = /\{[^{}]+\}/g;

// Keys that intentionally contain content in the "wrong" alphabet —
// the EN leaf is Japanese-only or vice versa, by design (locale-specific
// language-toggle button labels, Japanese-resident contact rows, etc.).
// New entries here MUST come with a one-line comment explaining why.
const CROSS_LOCALE_LEAK_ALLOWLIST: ReadonlySet<string> = new Set([
  // Language-toggle labels render the OTHER locale's name in their own
  // alphabet — the JA button shows "EN" (a Latin token) and the EN
  // button shows "日本語" (CJK). This is deliberate.
  "landing.locale_toggle.en",
  "landing.locale_toggle.ja",
  // The access-pending and access-denied screens render BOTH locales
  // in parallel (one body in JA, one in EN, side by side). The keys
  // suffixed _ja / _en hold the JA-text / EN-text directly — a Latin
  // string in JA's "title_en" leaf is correct.
  "access_pending.title_ja",
  "access_pending.title_en",
  "access_pending.body_ja",
  "access_pending.body_en",
  "access_denied.title_ja",
  "access_denied.title_en",
  "access_denied.body_ja",
  "access_denied.body_en",
  "access_denied.contact_label_ja",
  "access_denied.contact_label_en",
  "access_denied.contact_email",
]);

// Latin-only check: every char is ASCII letter / digit / common punctuation /
// whitespace. We use a permissive char-class to allow numbers, hyphens,
// brackets — anything that isn't a CJK or non-Latin alphabet character.
const LATIN_ONLY_RE = /^[\x20-\x7E\s]*$/;
const HAS_CJK_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

type Leaf = { path: string; value: string };

function walkLeaves(obj: Record<string, unknown>, prefix = ""): Leaf[] {
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out.push({ path, value: v });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "string") {
          out.push({ path: `${path}[${i}]`, value: item });
        } else if (item && typeof item === "object") {
          out.push(
            ...walkLeaves(item as Record<string, unknown>, `${path}[${i}]`)
          );
        }
      });
    } else if (v && typeof v === "object") {
      out.push(...walkLeaves(v as Record<string, unknown>, path));
    }
  }
  return out;
}

function placeholdersOf(value: string): Set<string> {
  return new Set(value.match(PLACEHOLDER_RE) ?? []);
}

describe("i18n leaf parity", () => {
  const enLeaves = walkLeaves(en as unknown as Record<string, unknown>);
  const jaLeaves = walkLeaves(ja as unknown as Record<string, unknown>);
  const jaByPath = new Map(jaLeaves.map((l) => [l.path, l.value]));
  const enByPath = new Map(enLeaves.map((l) => [l.path, l.value]));

  it("every EN leaf is non-empty", () => {
    const empty = enLeaves.filter((l) => l.value.trim().length === 0);
    expect(empty, `Empty EN leaves: ${empty.map((l) => l.path).join(", ")}`)
      .toEqual([]);
  });

  it("every JA leaf is non-empty", () => {
    const empty = jaLeaves.filter((l) => l.value.trim().length === 0);
    expect(empty, `Empty JA leaves: ${empty.map((l) => l.path).join(", ")}`)
      .toEqual([]);
  });

  it("placeholder sets match between EN and JA at every key", () => {
    const mismatches: string[] = [];
    for (const en of enLeaves) {
      const jaVal = jaByPath.get(en.path);
      if (jaVal === undefined) continue; // structural parity is its own test
      const enPh = placeholdersOf(en.value);
      const jaPh = placeholdersOf(jaVal);
      if (enPh.size !== jaPh.size) {
        mismatches.push(
          `${en.path}: en=${[...enPh].join(",") || "∅"} ja=${[...jaPh].join(",") || "∅"}`
        );
        continue;
      }
      for (const ph of enPh) {
        if (!jaPh.has(ph)) {
          mismatches.push(
            `${en.path}: en has ${ph} but ja does not (en=${[...enPh].join(",")}, ja=${[...jaPh].join(",")})`
          );
          break;
        }
      }
    }
    expect(mismatches, `Placeholder mismatches:\n  ${mismatches.join("\n  ")}`)
      .toEqual([]);
  });

  it("warns when a JA leaf contains zero CJK characters (likely EN leak)", () => {
    const warnings: string[] = [];
    for (const ja of jaLeaves) {
      if (CROSS_LOCALE_LEAK_ALLOWLIST.has(ja.path)) continue;
      const trimmed = ja.value.trim();
      if (trimmed.length === 0) continue;
      // Very short identifier-shaped strings (e.g. URLs, email tokens) are
      // routinely Latin-only in both locales — skip those.
      if (trimmed.length <= 3) continue;
      // If the value is mostly placeholders + Latin, it's still suspect.
      const stripped = trimmed.replace(PLACEHOLDER_RE, "").trim();
      if (stripped.length === 0) continue;
      if (LATIN_ONLY_RE.test(stripped)) {
        warnings.push(`${ja.path}: ${JSON.stringify(stripped)}`);
      }
    }
    if (warnings.length > 0) {
      // Soft warning, not a fail. Surface in test output so polish-19's
      // sweep can pick them up.
      console.warn(
        `[i18n-parity] ${warnings.length} JA leaf(s) look Latin-only:\n  ${warnings.join("\n  ")}`
      );
    }
  });

  it("warns when an EN leaf contains CJK characters (likely JA leak)", () => {
    const warnings: string[] = [];
    for (const en of enLeaves) {
      if (CROSS_LOCALE_LEAK_ALLOWLIST.has(en.path)) continue;
      if (HAS_CJK_RE.test(en.value)) {
        warnings.push(`${en.path}: ${JSON.stringify(en.value)}`);
      }
    }
    if (warnings.length > 0) {
      console.warn(
        `[i18n-parity] ${warnings.length} EN leaf(s) contain CJK:\n  ${warnings.join("\n  ")}`
      );
    }
  });

  it("EN and JA expose the same leaf paths (defense-in-depth on TS type)", () => {
    const enPaths = new Set(enLeaves.map((l) => l.path));
    const jaPaths = new Set(jaLeaves.map((l) => l.path));
    const onlyEn = [...enPaths].filter((p) => !jaPaths.has(p));
    const onlyJa = [...jaPaths].filter((p) => !enPaths.has(p));
    expect({ onlyEn, onlyJa }).toEqual({ onlyEn: [], onlyJa: [] });
    void enByPath; // silence unused-var warning when test passes
  });
});
