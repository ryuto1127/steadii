import { notFound } from "next/navigation";
import { TodayBriefing } from "@/components/agent/today-briefing";
import type { QueueCard } from "@/lib/agent/queue/types";
import { QueuePreviewClient } from "./client";

// Wave 2 verification harness. Renders all 5 archetype cards + the
// command palette + the empty state + Today briefing on a single
// route so engineer-side screenshots capture every variant in one
// sweep at 1440×900. Per handoff: "mock data is OK if real fanout
// doesn't yield variety — capture the rendering, not the data".
//
// Hard-gated behind NODE_ENV !== "production" so this route can never
// leak to a deployed build. The route also bypasses auth — fine
// because it never runs against a live user database.

export const dynamic = "force-dynamic";

const NOW = new Date();

const FIXED_DATE = (mins: number) =>
  new Date(NOW.getTime() - mins * 60 * 1000).toISOString();

const MOCK_CARDS: QueueCard[] = [
  {
    id: "proposal:00000000-0000-0000-0000-000000000001",
    archetype: "A",
    title: "Calendar conflict",
    body: "MAT223 lecture overlaps with the dentist appointment Friday 10:00–11:00. Pick how Steadii should resolve it.",
    confidence: "high",
    createdAt: FIXED_DATE(8),
    detailHref: "#",
    reversible: true,
    options: [
      {
        key: "reschedule",
        label: "Move dentist to Friday 14:00",
        description: "Rescheduling is reversible within 10s.",
        recommended: true,
      },
      { key: "skip_class", label: "Skip lecture, keep appointment" },
      { key: "do_nothing", label: "Decide later" },
    ],
    sources: [
      { kind: "calendar", index: 1, label: "Dentist · Fri 10:00" },
      { kind: "calendar", index: 2, label: "MAT223 · Fri 10:30" },
    ],
    issueType: "time_conflict",
  },
  {
    id: "draft:00000000-0000-0000-0000-000000000002",
    archetype: "B",
    title: "Prof. Tanaka",
    body: "re: Office hours availability",
    confidence: "medium",
    createdAt: FIXED_DATE(35),
    detailHref: "#",
    originHref: "#",
    originLabel: "Open thread",
    reversible: true,
    draftPreview:
      "Tanaka 教授、お世話になっております。来週の水曜日のオフィスアワーに参加したく、15 分ほどお時間をいただけますでしょうか。MAT223 の章 5 の質問が中心で、事前に整理しておきます。よろしくお願いします。",
    subjectLine: "Office hours availability — MAT223",
    toLabel: "To: tanaka.pro@u-tokyo.ac.jp",
    sources: [
      { kind: "email", index: 1, label: "Tanaka original — Apr 28" },
      { kind: "syllabus", index: 1, label: "MAT223 syllabus ch.5" },
    ],
  },
  {
    id: "proposal:00000000-0000-0000-0000-000000000003",
    archetype: "C",
    title: "Group project — quiet member",
    body: "Hayashi-san hasn't responded in 9 days on the COMM240 group thread. Want me to draft a check-in?",
    confidence: "medium",
    createdAt: FIXED_DATE(120),
    detailHref: "#",
    originHref: "#",
    originLabel: "Open thread",
    reversible: false,
    primaryActionLabel: "Draft a check-in",
    sources: [{ kind: "email", index: 1, label: "Group thread · COMM240" }],
  },
  {
    id: "draft:00000000-0000-0000-0000-000000000004",
    archetype: "E",
    title: "ECO101 — extension request",
    body: "Steadii needs a date — what new deadline should we ask for? Pick one or type a custom date.",
    confidence: "low",
    createdAt: FIXED_DATE(180),
    detailHref: "#",
    originHref: "#",
    originLabel: "Open thread",
    reversible: false,
    choices: [
      { key: "plus_3", label: "+3 days (Mon)" },
      { key: "plus_5", label: "+5 days (Wed)" },
      { key: "plus_7", label: "+7 days (Fri)" },
    ],
    sources: [{ kind: "email", index: 1, label: "ECO101 prof — extension" }],
  },
  {
    id: "draft:00000000-0000-0000-0000-000000000005",
    archetype: "D",
    title: "Archived 12 newsletter messages",
    body: "Auto-archived per sender rule",
    actionVerb: "Archived",
    confidence: "high",
    createdAt: FIXED_DATE(360),
    reversible: true,
    sources: [],
  },
];

export default async function QueuePreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await searchParams;
  const showEmpty = state === "empty";
  const showNotifications = state === "notifications";

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-8">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))]">
          おはようございます、Ryuto。
        </h1>
        <p className="text-[15px] text-[hsl(var(--muted-foreground))]">
          Here&apos;s where you are this week.
        </p>
      </header>

      <QueuePreviewClient
        cards={MOCK_CARDS}
        showEmpty={showEmpty}
        variant={showNotifications ? "notifications" : "default"}
      />

      {showNotifications ? null : (
        <TodayBriefing
          events={[
            {
              id: "e1",
              title: "MAT223 — chapter 5 lecture",
              start: new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(),
              end: new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString(),
              location: "Bahen 1170",
            },
            {
              id: "e2",
              title: "Group project sync",
              start: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
              end: new Date(NOW.getTime() + 7 * 60 * 60 * 1000).toISOString(),
            },
          ]}
          todayTasks={[
            { id: "t1", title: "Submit ECO101 problem set 4", classTitle: "ECO101" },
            { id: "t2", title: "Read MAT223 §5.3", classTitle: "MAT223" },
          ]}
          upcomingDeadlines={[
            {
              id: "d1",
              title: "PSY100 essay draft",
              due: new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString(),
              classColor: null,
              classTitle: "PSY100",
            },
            {
              id: "d2",
              title: "MAT223 problem set 6",
              due: new Date(NOW.getTime() + 96 * 60 * 60 * 1000).toISOString(),
              classColor: null,
              classTitle: "MAT223",
            },
          ]}
          tz="America/Toronto"
        />
      )}
    </div>
  );
}
