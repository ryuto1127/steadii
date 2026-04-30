import { describe, expect, it, vi } from "vitest";

// next-intl in vitest node env. Returns an identity-ish translator that
// substitutes {n} so the rendered output is deterministic without
// depending on the live translation tables. The component picks one of
// four keys (full/short × words/chars); the namespace prefix isn't used
// in this stub.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const n = vars?.n;
    switch (key) {
      case "choice_full_words":
        return `Send full (~${n}w)`;
      case "choice_full_chars":
        return `Send full (~${n}字)`;
      case "choice_short_words":
        return `Send short (~${n}w)`;
      case "choice_short_chars":
        return `Send short (~${n}字)`;
      case "choice_label":
        return "Pick voice message length";
      default:
        return key;
    }
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { VoiceChoice } from "@/components/chat/voice-choice";

describe("<VoiceChoice />", () => {
  it("renders both pill buttons with words units when input is EN-dominant", () => {
    const html = renderToStaticMarkup(
      createElement(VoiceChoice, {
        cleaned: "today I want to go to the library after class",
        shortened: "library after class",
        onSelect: () => {},
      })
    );
    expect(html).toContain("Send full (~10w)");
    expect(html).toContain("Send short (~3w)");
    expect(html).toContain('aria-label="Pick voice message length"');
  });

  it("renders chars units when input is JP-dominant", () => {
    const html = renderToStaticMarkup(
      createElement(VoiceChoice, {
        cleaned: "今日はとても眠くて課題が手につかない",
        shortened: "課題できない",
        onSelect: () => {},
      })
    );
    expect(html).toMatch(/Send full \(~\d+字\)/);
    expect(html).toMatch(/Send short \(~\d+字\)/);
  });

  it("emits exactly two buttons (full + short)", () => {
    const html = renderToStaticMarkup(
      createElement(VoiceChoice, {
        cleaned: "alpha beta gamma",
        shortened: "alpha",
        onSelect: () => {},
      })
    );
    const buttonOpens = html.match(/<button/g) ?? [];
    expect(buttonOpens).toHaveLength(2);
  });
});
