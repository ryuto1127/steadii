import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  buildWeeklyHtml,
  buildWeeklySubject,
  type WeeklyDigestStats,
} from "@/lib/digest/weekly-build";
import { selectTopMoments } from "@/lib/digest/top-moments";
import {
  estimateSecondsSaved,
  type WeeklyStats,
} from "@/lib/digest/time-saved";
import type { DigestLocale } from "@/lib/digest/build";

// Verification harness for the post-α #5 weekly retrospective digest.
// Renders both heavy and light variants in the user's current locale at
// 1440×900 so the screenshot sweep can capture EN + JA without touching
// the DB. Hard-gated behind NODE_ENV !== "production".

export const dynamic = "force-dynamic";

const HEAVY_BASE: WeeklyStats = {
  archivedCount: 47,
  draftsSentUnmodified: 11,
  draftsSentEdited: 1,
  calendarImports: 5,
  proposalsResolved: 2,
};
const HEAVY_STATS: WeeklyDigestStats = {
  ...HEAVY_BASE,
  draftsSent: HEAVY_BASE.draftsSentUnmodified + HEAVY_BASE.draftsSentEdited,
  draftsDismissed: 4,
  deadlinesCaught: 3,
};

const LIGHT_BASE: WeeklyStats = {
  archivedCount: 2,
  draftsSentUnmodified: 4,
  draftsSentEdited: 0,
  calendarImports: 1,
  proposalsResolved: 1,
};
const LIGHT_STATS: WeeklyDigestStats = {
  ...LIGHT_BASE,
  draftsSent: LIGHT_BASE.draftsSentUnmodified + LIGHT_BASE.draftsSentEdited,
  draftsDismissed: 0,
  deadlinesCaught: 0,
};

const HEAVY_MOMENTS_EN = selectTopMoments([
  {
    id: "m1",
    source: "draft",
    subject: "Caught the ECON 200 essay due Friday before you noticed",
    occurredAt: new Date("2026-05-02T14:00:00Z"),
    riskTier: "high",
    sentUnmodified: true,
  },
  {
    id: "m2",
    source: "draft",
    subject: "Drafted reply to Prof. Tanaka while you were in class",
    occurredAt: new Date("2026-05-01T18:00:00Z"),
    riskTier: "medium",
    sentUnmodified: true,
    context: "deadline next Mon",
  },
  {
    id: "m3",
    source: "calendar_import",
    subject: "MAT223 midterm — May 18 added from syllabus",
    occurredAt: new Date("2026-04-30T10:00:00Z"),
  },
]);

const HEAVY_MOMENTS_JA = selectTopMoments([
  {
    id: "m1",
    source: "draft",
    subject: "ECON 200 のエッセイ提出について返信を準備しました",
    occurredAt: new Date("2026-05-02T14:00:00Z"),
    riskTier: "high",
    sentUnmodified: true,
  },
  {
    id: "m2",
    source: "draft",
    subject: "田中先生への返信を準備しました（締切リマインド）",
    occurredAt: new Date("2026-05-01T18:00:00Z"),
    riskTier: "medium",
    sentUnmodified: true,
    context: "提出期限あり",
  },
  {
    id: "m3",
    source: "calendar_import",
    subject: "MAT223 中間試験 — 5/18 をシラバスから追加",
    occurredAt: new Date("2026-04-30T10:00:00Z"),
  },
]);

export default async function WeeklyDigestPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const localeRaw = await getLocale();
  const locale: DigestLocale = localeRaw === "ja" ? "ja" : "en";
  const appUrl = "https://mysteadii.com";

  const heavySubject = buildWeeklySubject(HEAVY_STATS, locale);
  const lightSubject = buildWeeklySubject(LIGHT_STATS, locale);
  const heavySeconds = estimateSecondsSaved(HEAVY_BASE);
  const lightSeconds = estimateSecondsSaved(LIGHT_BASE);

  const heavyHtml = buildWeeklyHtml({
    stats: HEAVY_STATS,
    moments: locale === "ja" ? HEAVY_MOMENTS_JA : HEAVY_MOMENTS_EN,
    secondsSaved: heavySeconds,
    appUrl,
    locale,
  });
  const lightHtml = buildWeeklyHtml({
    stats: LIGHT_STATS,
    moments: [],
    secondsSaved: lightSeconds,
    appUrl,
    locale,
  });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 p-6">
      <header>
        <h1 className="text-h1">Weekly digest preview</h1>
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          Heavy and light variants — locale: {locale}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-h2">Heavy week</h2>
        <p className="mb-3 font-mono text-small text-[hsl(var(--muted-foreground))]">
          Subject: {heavySubject}
        </p>
        <div
          className="rounded-lg border border-[hsl(var(--border))]"
          dangerouslySetInnerHTML={{ __html: heavyHtml }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-h2">Light week</h2>
        <p className="mb-3 font-mono text-small text-[hsl(var(--muted-foreground))]">
          Subject: {lightSubject}
        </p>
        <div
          className="rounded-lg border border-[hsl(var(--border))]"
          dangerouslySetInnerHTML={{ __html: lightHtml }}
        />
      </section>
    </main>
  );
}
