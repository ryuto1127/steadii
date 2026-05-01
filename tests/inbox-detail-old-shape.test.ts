import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { en as enMessages } from "@/lib/i18n/translations/en";

// Resolve a t-style key path against the canonical EN message tree so
// tests still assert on real user-visible strings (not key names). Used
// by the next-intl mocks below — the components have moved to i18n
// hooks but vitest doesn't run a Next.js request scope, so we provide a
// minimal stand-in that walks `${namespace}.${key}` and substitutes
// {placeholder} values.
function tFor(namespace?: string) {
  return (
    key: string,
    values?: Record<string, string | number>
  ): string => {
    const fullPath = namespace ? `${namespace}.${key}` : key;
    let cur: unknown = enMessages;
    for (const part of fullPath.split(".")) {
      if (cur && typeof cur === "object" && part in cur) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    let s = typeof cur === "string" ? cur : fullPath;
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  };
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => tFor(namespace),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace?: string) => tFor(namespace),
}));

// Components must be imported AFTER the vi.mock calls (vi.mock hoists to
// the top of the file at parse time, but explicit late imports keep the
// reading order obvious).
const { ThinkingBar } = await import("@/components/agent/thinking-bar");
const { ReasoningPanel } = await import(
  "@/components/agent/reasoning-panel"
);
import type { RetrievalProvenance } from "@/lib/db/schema";

// Regression coverage for Sentry 3659247778 — production user landed on
// /app/inbox/[draft-id] with a pre-W1 agent_drafts row whose
// retrieval_provenance / reasoning predates the multi-source fanout
// widening. The page error-boundaried because one of the W1 components
// threw on the legacy shape. These fixtures exercise every shape we know
// has shipped to prod plus a couple of "JSONB drift" cases (missing
// fields, unknown discriminators) so we never regress on graceful
// degradation again.

describe("Inbox detail — pre-W1 + drift shapes", () => {
  it("ThinkingBar renders an email-only pre-W1 provenance without throwing", async () => {
    // Pre-W1 shape: only `email` sources, no fanoutCounts, no classBinding.
    const provenance = {
      sources: [
        {
          type: "email" as const,
          id: "inbox-1",
          similarity: 0.82,
          snippet: "Re: assignment 3",
        },
        {
          type: "email" as const,
          id: "inbox-2",
          similarity: 0.74,
          snippet: "Office hours moved",
        },
      ],
      total_candidates: 12,
      returned: 2,
    };
    const element = await ThinkingBar({ provenance, riskTier: "medium" });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Thinking · complete");
    expect(html).toContain("2 of 12 emails surfaced");
    expect(html).toContain("82%");
  });

  it("ThinkingBar tolerates a null provenance (low-risk no_op draft)", async () => {
    const element = await ThinkingBar({ provenance: null, riskTier: "low" });
    const html = renderToStaticMarkup(element);
    // Engineer 17's i18n shipped tier labels as bare "Low"/"Medium"/"High"
    // without the trailing "risk" word — the visual tier pill / surrounding
    // copy carries that semantic in context.
    expect(html).toContain("Low");
  });

  it("ThinkingBar drops unknown source-type discriminators instead of throwing", async () => {
    // JSONB-drift case: a row with a future/typo source type alongside
    // valid email sources should render the valid pills and ignore the
    // unknown one rather than crashing the whole page. Cast through
    // `unknown` because the union doesn't admit the drift shape — that
    // mismatch is exactly what we want to exercise at runtime.
    const provenance = {
      sources: [
        { type: "email", id: "e1", similarity: 0.5, snippet: "ok" },
        { type: "future_kind", id: "x1", payload: "???" },
      ],
      total_candidates: 5,
      returned: 1,
    } as unknown as RetrievalProvenance;
    const element = await ThinkingBar({ provenance, riskTier: "high" });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("email-1");
    expect(html).not.toContain("future_kind");
  });

  it("ThinkingBar falls back when similarity is missing or non-numeric", async () => {
    const provenance = {
      sources: [
        { type: "email", id: "e1", snippet: "no similarity field" },
      ],
      total_candidates: 1,
      returned: 1,
    } as unknown as RetrievalProvenance;
    const element = await ThinkingBar({ provenance, riskTier: "medium" });
    const html = renderToStaticMarkup(element);
    // formatSimilarityPct returns "—" when value is non-finite.
    expect(html).toContain("—");
  });

  it("ThinkingBar tolerates a malformed classBinding (missing confidence)", async () => {
    const provenance = {
      sources: [],
      total_candidates: 0,
      returned: 0,
      classBinding: {
        classId: "c1",
        className: "CSC110",
        classCode: null,
        method: "subject_code",
      },
    } as unknown as RetrievalProvenance;
    const element = await ThinkingBar({ provenance, riskTier: "low" });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Bound to");
    expect(html).toContain("CSC110");
  });

  it("ReasoningPanel renders pre-W1 plain reasoning with no citation tags", () => {
    const reasoning =
      "Sender is your CSC110 instructor. The email asks for a confirmation by Friday — proposing a draft acknowledging.";
    const html = renderToStaticMarkup(
      createElement(ReasoningPanel, { reasoning, action: "draft_reply" })
    );
    expect(html).toContain("Why this draft");
    expect(html).toContain("Friday");
  });

  it("ReasoningPanel renders W1 reasoning with citation tags as superscripts", () => {
    const reasoning =
      "Sender previously asked similar questions (mistake-1) and the syllabus deadline matches (syllabus-2).";
    const html = renderToStaticMarkup(
      createElement(ReasoningPanel, { reasoning })
    );
    expect(html).toContain("mistake-1");
    expect(html).toContain("syllabus-2");
    expect(html).toContain("data-source-ref");
  });

  it("ReasoningPanel returns null on empty reasoning instead of throwing", () => {
    const html = renderToStaticMarkup(
      createElement(ReasoningPanel, { reasoning: null })
    );
    expect(html).toBe("");
  });
});
