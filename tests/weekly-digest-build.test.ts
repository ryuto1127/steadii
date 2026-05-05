import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {},
  agentProposals: {},
  auditLog: {},
  inboxItems: {},
  users: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  between: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ APP_URL: "https://mysteadii.com" }),
}));

import {
  buildWeeklySubject,
  buildWeeklyText,
  buildWeeklyHtml,
  type WeeklyDigestStats,
} from "@/lib/digest/weekly-build";
import type { SelectedMoment } from "@/lib/digest/top-moments";

const HEAVY_STATS: WeeklyDigestStats = {
  archivedCount: 47,
  draftsSent: 12,
  draftsSentUnmodified: 12,
  draftsSentEdited: 0,
  draftsDismissed: 2,
  deadlinesCaught: 3,
  calendarImports: 5,
  proposalsResolved: 2,
};

const LIGHT_STATS: WeeklyDigestStats = {
  archivedCount: 2,
  draftsSent: 4,
  draftsSentUnmodified: 4,
  draftsSentEdited: 0,
  draftsDismissed: 0,
  deadlinesCaught: 0,
  calendarImports: 1,
  proposalsResolved: 1,
};

const SAMPLE_MOMENTS: SelectedMoment[] = [
  {
    id: "m1",
    source: "draft",
    subject: "ECON 200 essay due Friday",
    occurredAt: new Date("2026-05-02T15:00:00Z"),
    priority: 1,
    riskTier: "high",
    sentUnmodified: true,
  },
];

describe("buildWeeklySubject", () => {
  it("renders heavy-week wording in EN", () => {
    expect(buildWeeklySubject(HEAVY_STATS, "en")).toBe(
      "Your week with Steadii — 47 archived, 12 drafted, 3 deadlines caught"
    );
  });

  it("renders light-week wording in EN", () => {
    expect(buildWeeklySubject(LIGHT_STATS, "en")).toBe(
      "A quiet week — Steadii did 8 things"
    );
  });

  it("renders heavy-week wording in JA", () => {
    expect(buildWeeklySubject(HEAVY_STATS, "ja")).toBe(
      "今週の Steadii — 47 件アーカイブ、12 件下書き、締切 3 件キャッチ"
    );
  });
});

describe("buildWeeklyText / buildWeeklyHtml", () => {
  const appUrl = "https://mysteadii.com";

  it("EN body links to /app/activity with weekly_digest utm tag", () => {
    const text = buildWeeklyText({
      stats: HEAVY_STATS,
      moments: SAMPLE_MOMENTS,
      secondsSaved: 1234,
      appUrl,
      locale: "en",
    });
    expect(text).toContain(
      "https://mysteadii.com/app/activity?utm_source=weekly_digest"
    );
    expect(text).toContain("Archived: 47");
    expect(text).toContain("Drafts sent: 12");
  });

  it("JA body uses native units in stats and CTA", () => {
    const text = buildWeeklyText({
      stats: HEAVY_STATS,
      moments: SAMPLE_MOMENTS,
      secondsSaved: 1234,
      appUrl,
      locale: "ja",
    });
    expect(text).toContain("アーカイブ: 47");
    expect(text).toContain("送信した下書き: 12");
    expect(text).toContain("時間の節約: 約");
    expect(text).toContain("すべての記録を見る");
  });

  it("HTML body escapes moment subjects to prevent XSS", () => {
    const html = buildWeeklyHtml({
      stats: HEAVY_STATS,
      moments: [
        {
          ...SAMPLE_MOMENTS[0]!,
          subject: `<script>alert(1)</script>`,
        },
      ],
      secondsSaved: 100,
      appUrl,
      locale: "en",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML body still renders without any moments", () => {
    const html = buildWeeklyHtml({
      stats: LIGHT_STATS,
      moments: [],
      secondsSaved: 0,
      appUrl,
      locale: "en",
    });
    expect(html).toContain("Your week in review");
    expect(html).toContain("See the full activity log →");
  });
});
