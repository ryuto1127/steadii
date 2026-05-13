import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { monthlyDigests } from "@/lib/agent/digest/monthly-digests-table";
import { formatMonthLabel } from "@/lib/agent/digest/monthly-build";
import type { MonthlySynthesis } from "@/lib/agent/digest/monthly-synthesis";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function MonthlyDigestDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;
  const locale = (await getLocale()) === "ja" ? "ja" : "en";
  const t = await getTranslations("digest");

  const [row] = await db
    .select({
      id: monthlyDigests.id,
      monthStart: monthlyDigests.monthStart,
      synthesis: monthlyDigests.synthesis,
      sentAt: monthlyDigests.sentAt,
      readAt: monthlyDigests.readAt,
      createdAt: monthlyDigests.createdAt,
    })
    .from(monthlyDigests)
    .where(and(eq(monthlyDigests.id, id), eq(monthlyDigests.userId, userId)))
    .limit(1);
  if (!row) notFound();

  // Stamp readAt on first view — analytics signal so the dashboard
  // can measure CoS-digest engagement. Fire-and-forget; no UI gate.
  if (!row.readAt) {
    await db
      .update(monthlyDigests)
      .set({ readAt: new Date() })
      .where(eq(monthlyDigests.id, row.id));
  }

  const synthesis = (row.synthesis as MonthlySynthesis) ?? {
    oneLineSummary: "",
    themes: [],
    recommendations: [],
    driftCallouts: [],
  };
  const isoKey = `${row.monthStart.getUTCFullYear()}-${String(
    row.monthStart.getUTCMonth() + 1
  ).padStart(2, "0")}`;
  const monthLabel = formatMonthLabel(isoKey, locale);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href="/app/digests/monthly"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          <span>{t("monthly.back_to_index")}</span>
        </Link>
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("monthly.detail_eyebrow")}
          </p>
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] md:text-[28px]">
            {monthLabel}
          </h1>
          {synthesis.oneLineSummary ? (
            <p className="mt-2 text-[15px] leading-[1.5] text-[hsl(var(--foreground))]">
              {synthesis.oneLineSummary}
            </p>
          ) : null}
        </div>
      </header>

      {synthesis.themes.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("monthly.section_themes")}
          </h2>
          <div className="flex flex-col gap-3">
            {synthesis.themes.map((theme, idx) => (
              <article
                key={`theme-${idx}`}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
              >
                <h3 className="font-display text-[15px] font-semibold text-[hsl(var(--foreground))]">
                  {theme.title}
                </h3>
                <p className="mt-1 text-[13px] leading-[1.5] text-[hsl(var(--foreground))]">
                  {theme.body}
                </p>
                {theme.evidence.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {theme.evidence.map((e, eIdx) => (
                      <EvidenceChip
                        key={`evidence-${idx}-${eIdx}`}
                        kind={e.kind}
                        id={e.id}
                        label={e.label}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {synthesis.recommendations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("monthly.section_recommendations")}
          </h2>
          <ul className="flex flex-col gap-2">
            {synthesis.recommendations.map((r, idx) => (
              <li
                key={`rec-${idx}`}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
              >
                <div className="font-display text-[14px] font-semibold text-[hsl(var(--foreground))]">
                  {r.action}
                </div>
                <div className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {r.why}
                </div>
                {r.suggestedDate ? (
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {t("monthly.suggested_date_label")}: {r.suggestedDate}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {synthesis.driftCallouts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("monthly.section_drift")}
          </h2>
          <ul className="flex flex-col gap-2">
            {synthesis.driftCallouts.map((d, idx) => (
              <li
                key={`drift-${idx}`}
                className={`rounded-lg border px-4 py-3 text-[13px] leading-[1.5] ${driftClasses(
                  d.severity
                )}`}
              >
                {d.callout}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {synthesis.themes.length === 0 &&
      synthesis.recommendations.length === 0 &&
      synthesis.driftCallouts.length === 0 ? (
        <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
          {t("monthly.detail_empty")}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceChip({
  kind,
  id,
  label,
}: {
  kind: MonthlySynthesis["themes"][number]["evidence"][number]["kind"];
  id: string;
  label: string;
}) {
  const href = evidenceHref(kind, id);
  const body = (
    <span className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
      <span className="opacity-70">{kindLabel(kind)}</span>
      <span className="normal-case tracking-normal text-[hsl(var(--foreground))]">
        {truncate(label, 60)}
      </span>
    </span>
  );
  if (!href) return body;
  return <Link href={href}>{body}</Link>;
}

function evidenceHref(
  kind: MonthlySynthesis["themes"][number]["evidence"][number]["kind"],
  id: string
): string | null {
  switch (kind) {
    case "email_thread":
      return `/app/inbox/${id}`;
    case "assignment":
      return `/app/tasks?focus=${id}`;
    case "event":
      return `/app/calendar?focus=${id}`;
    case "chat_session":
      return `/app/chat/${id}`;
    case "proactive_proposal":
      return `/app/inbox/proposals?focus=${id}`;
    default:
      return null;
  }
}

function kindLabel(
  kind: MonthlySynthesis["themes"][number]["evidence"][number]["kind"]
): string {
  switch (kind) {
    case "email_thread":
      return "email";
    case "assignment":
      return "task";
    case "event":
      return "event";
    case "chat_session":
      return "chat";
    case "proactive_proposal":
      return "queue";
    default:
      return String(kind);
  }
}

function driftClasses(severity: "info" | "warn" | "high"): string {
  if (severity === "high") {
    return "border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.05)] text-[hsl(var(--destructive))]";
  }
  if (severity === "warn") {
    return "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300";
  }
  return "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
