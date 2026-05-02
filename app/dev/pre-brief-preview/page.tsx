import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar as CalendarIcon, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Wave 3.1 verification harness — renders the pre-brief detail page
// with hardcoded mock data so engineer-side screenshots can capture
// the layout without requiring a real cron-generated brief.
//
// Hard-gated behind NODE_ENV !== "production" so this route never leaks.

export const dynamic = "force-dynamic";

const MOCK_BRIEF = {
  bullets: [
    {
      text: "Last email from Prof. Tanaka (Apr 28): granted 5-day extension on PS5 — confirmed.",
    },
    {
      text: "Open thread from Apr 26: ch.5 §3 linear-transform example, you asked about step 4.",
    },
    {
      text: "Pending decision: which textbook chapter to focus on next — Tanaka asked you to choose.",
    },
    {
      text: "Deadline this week: midterm prep packet due Fri (5/16); 2 mistake notes still open in MAT223.",
    },
  ],
  detailMarkdown: `## Recent thread context

- **Apr 28** — Prof. Tanaka granted a 5-day extension on Problem Set 5. New due date: May 3.
- **Apr 26** — You asked about the chapter 5 §3 linear-transform example, specifically step 4 ("why does we factor out the determinant here?"). The thread is still open; you have not heard back since.
- **Apr 22** — Prof. Tanaka asked you to pick which chapter to focus on next: ch.6 (eigenvectors) or ch.7 (orthogonal projections). You replied saying you'd think about it.

## What you might want to bring up

1. Resolve the chapter pick from Apr 22.
2. Walk through the §3 step-4 confusion with a concrete example.
3. Briefly mention midterm prep — packet due Friday (5/16), and 2 mistake notes from the past 2 weeks both touch §3.4.

## Past-meeting carryover

You and Prof. Tanaka had a 1:1 on Apr 14 where you committed to:
- Submit PS5 by Apr 28 (extended to May 3 — done).
- Meet again before midterm — *this is that meeting*.`,
  attendeeEmails: ["tanaka.pro@u-tokyo.ac.jp"],
};

const MOCK_EVENT = {
  title: "MAT223 office hours",
  startsAt: new Date(),
  location: "MP203",
  url: "https://calendar.google.com/event?...",
};

export default async function PreBriefPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const t = await getTranslations("pre_brief");
  const startFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(MOCK_EVENT.startsAt);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href="/app"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          <span>{t("back_to_home")}</span>
        </Link>
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] md:text-[28px]">
            {MOCK_EVENT.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-[hsl(var(--muted-foreground))]">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} strokeWidth={1.75} />
              {startFmt}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarIcon size={12} strokeWidth={1.75} />
              {MOCK_EVENT.location}
            </span>
            <a
              href={MOCK_EVENT.url}
              className="ml-auto inline-flex items-center text-[hsl(var(--primary))] underline-offset-2 hover:underline"
            >
              {t("open_in_calendar")}
            </a>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("at_a_glance")}
        </h2>
        <ul className="flex flex-col gap-2">
          {MOCK_BRIEF.bullets.map((b, i) => (
            <li
              key={i}
              className="flex gap-2 text-[14px] leading-snug text-[hsl(var(--foreground))]"
            >
              <span
                aria-hidden
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]"
              />
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("full_briefing")}
        </h2>
        <div
          style={{ maxWidth: "none" }}
          className="prose prose-sm text-[14px] leading-relaxed text-[hsl(var(--foreground))]"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {MOCK_BRIEF.detailMarkdown}
          </ReactMarkdown>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("attendees")}
        </h2>
        <ul className="flex flex-wrap gap-1.5">
          {MOCK_BRIEF.attendeeEmails.map((e) => (
            <li
              key={e}
              className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2.5 py-0.5 text-[12px] text-[hsl(var(--foreground))]"
            >
              {e}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
