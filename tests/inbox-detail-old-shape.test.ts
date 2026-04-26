import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ThinkingBar } from "@/components/agent/thinking-bar";
import { ReasoningPanel } from "@/components/agent/reasoning-panel";
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
  it("ThinkingBar renders an email-only pre-W1 provenance without throwing", () => {
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
    const html = renderToStaticMarkup(
      createElement(ThinkingBar, { provenance, riskTier: "medium" })
    );
    expect(html).toContain("Thinking · complete");
    expect(html).toContain("2 of 12 emails surfaced");
    expect(html).toContain("82%");
  });

  it("ThinkingBar tolerates a null provenance (low-risk no_op draft)", () => {
    const html = renderToStaticMarkup(
      createElement(ThinkingBar, { provenance: null, riskTier: "low" })
    );
    expect(html).toContain("Low risk");
  });

  it("ThinkingBar drops unknown source-type discriminators instead of throwing", () => {
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
    const html = renderToStaticMarkup(
      createElement(ThinkingBar, { provenance, riskTier: "high" })
    );
    expect(html).toContain("email-1");
    expect(html).not.toContain("future_kind");
  });

  it("ThinkingBar falls back when similarity is missing or non-numeric", () => {
    const provenance = {
      sources: [
        { type: "email", id: "e1", snippet: "no similarity field" },
      ],
      total_candidates: 1,
      returned: 1,
    } as unknown as RetrievalProvenance;
    const html = renderToStaticMarkup(
      createElement(ThinkingBar, { provenance, riskTier: "medium" })
    );
    // formatSimilarityPct returns "—" when value is non-finite.
    expect(html).toContain("—");
  });

  it("ThinkingBar tolerates a malformed classBinding (missing confidence)", () => {
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
    const html = renderToStaticMarkup(
      createElement(ThinkingBar, { provenance, riskTier: "low" })
    );
    expect(html).toContain("Bound to");
    expect(html).toContain("CSC110");
  });

  it("ReasoningPanel renders pre-W1 plain reasoning with no citation tags", () => {
    const reasoning =
      "Sender is your CSC110 instructor. The email asks for a confirmation by Friday — proposing a draft acknowledging.";
    const html = renderToStaticMarkup(
      createElement(ReasoningPanel, { reasoning })
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
