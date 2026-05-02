import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Calendar as CalendarIcon, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  events as eventsTable,
  eventPreBriefs,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function PreBriefDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;
  const t = await getTranslations("pre_brief");

  const [row] = await db
    .select({ brief: eventPreBriefs, event: eventsTable })
    .from(eventPreBriefs)
    .innerJoin(eventsTable, eq(eventPreBriefs.eventId, eventsTable.id))
    .where(
      and(eq(eventPreBriefs.id, id), eq(eventPreBriefs.userId, userId))
    )
    .limit(1);
  if (!row) notFound();

  const { brief, event } = row;
  const startFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(event.startsAt);

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
            {event.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-[hsl(var(--muted-foreground))]">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} strokeWidth={1.75} />
              {startFmt}
            </span>
            {event.location ? (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon size={12} strokeWidth={1.75} />
                {event.location}
              </span>
            ) : null}
            {event.url ? (
              <a
                href={event.url}
                className="ml-auto inline-flex items-center text-[hsl(var(--primary))] underline-offset-2 hover:underline"
              >
                {t("open_in_calendar")}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("at_a_glance")}
        </h2>
        <ul className="flex flex-col gap-2">
          {brief.bullets.length === 0 ? (
            <li className="text-[13px] italic text-[hsl(var(--muted-foreground))]">
              {t("no_bullets")}
            </li>
          ) : (
            brief.bullets.map((b, i) => (
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
            ))
          )}
        </ul>
      </section>

      {brief.detailMarkdown ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("full_briefing")}
          </h2>
          <div
            style={{ maxWidth: "none" }}
            className="prose prose-sm text-[14px] leading-relaxed text-[hsl(var(--foreground))]"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {brief.detailMarkdown}
            </ReactMarkdown>
          </div>
        </section>
      ) : null}

      {brief.attendeeEmails.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("attendees")}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {brief.attendeeEmails.map((e) => (
              <li
                key={e}
                className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2.5 py-0.5 text-[12px] text-[hsl(var(--foreground))]"
              >
                {e}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
