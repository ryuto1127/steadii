import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMonthlyDigestEmail } from "@/lib/email/monthly-digest-template";
import type { MonthlySynthesis } from "@/lib/agent/digest/monthly-synthesis";

const SAMPLE_SYNTHESIS: MonthlySynthesis = {
  oneLineSummary: "Workload concentrated late in the month.",
  themes: [
    {
      title: "CS 348 PS slipping",
      body: "3 assignments in progress, 0 done.",
      evidence: [
        { kind: "assignment", id: "abc", label: "CS 348 PS4" },
      ],
    },
  ],
  recommendations: [
    {
      action: "Block 3 hours Saturday for CS 348 PS4",
      why: "Closes the carryover.",
      suggestedDate: "2026-05-09",
    },
  ],
  driftCallouts: [
    { callout: "You haven't messaged Mei in 23 days.", severity: "info" },
  ],
};

describe("buildMonthlyDigestEmail", () => {
  it("renders the EN subject", () => {
    const out = buildMonthlyDigestEmail({
      locale: "en",
      monthLabel: "April 2026",
      synthesis: SAMPLE_SYNTHESIS,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.subject).toBe(
      "Your monthly review from Steadii — April 2026"
    );
  });

  it("renders the JA subject", () => {
    const out = buildMonthlyDigestEmail({
      locale: "ja",
      monthLabel: "2026年4月",
      synthesis: SAMPLE_SYNTHESIS,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.subject).toBe(
      "Steadii からの月次レビュー — 2026年4月"
    );
  });

  it("renders theme titles + evidence labels in the body", () => {
    const out = buildMonthlyDigestEmail({
      locale: "en",
      monthLabel: "April 2026",
      synthesis: SAMPLE_SYNTHESIS,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.text).toContain("CS 348 PS slipping");
    expect(out.text).toContain("CS 348 PS4");
    expect(out.html).toContain("CS 348 PS slipping");
    expect(out.html).toContain("CS 348 PS4");
  });

  it("escapes HTML-unsafe characters in synthesis content", () => {
    const synth: MonthlySynthesis = {
      ...SAMPLE_SYNTHESIS,
      oneLineSummary: "Watch out for <script>alert(1)</script>",
      themes: [
        {
          title: "Class & section",
          body: "It's <important>",
          evidence: [],
        },
      ],
    };
    const out = buildMonthlyDigestEmail({
      locale: "en",
      monthLabel: "April 2026",
      synthesis: synth,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&amp;");
  });

  it("omits sections when arrays are empty", () => {
    const empty: MonthlySynthesis = {
      oneLineSummary: "Quiet month.",
      themes: [],
      recommendations: [],
      driftCallouts: [],
    };
    const out = buildMonthlyDigestEmail({
      locale: "en",
      monthLabel: "April 2026",
      synthesis: empty,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.text).not.toContain("Themes this month");
    expect(out.text).not.toContain("Steadii recommends");
    expect(out.text).not.toContain("Worth a look");
    expect(out.text).toContain("Quiet month.");
  });

  it("includes utm tag in CTA URL", () => {
    const out = buildMonthlyDigestEmail({
      locale: "en",
      monthLabel: "April 2026",
      synthesis: SAMPLE_SYNTHESIS,
      appUrl: "https://mysteadii.com",
      digestIndexUrl: "https://mysteadii.com/app/digests/monthly",
    });
    expect(out.html).toContain("utm_source=monthly_digest");
    expect(out.text).toContain("utm_source=monthly_digest");
  });
});
