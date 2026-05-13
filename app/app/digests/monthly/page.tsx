import { redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft, FileText } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { monthlyDigests } from "@/lib/agent/digest/monthly-digests-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMonthLabel } from "@/lib/agent/digest/monthly-build";
import type { MonthlySynthesis } from "@/lib/agent/digest/monthly-synthesis";

export const dynamic = "force-dynamic";

export default async function MonthlyDigestIndexPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const locale = (await getLocale()) === "ja" ? "ja" : "en";
  const t = await getTranslations("digest");

  const rows = await db
    .select({
      id: monthlyDigests.id,
      monthStart: monthlyDigests.monthStart,
      synthesis: monthlyDigests.synthesis,
      sentAt: monthlyDigests.sentAt,
      createdAt: monthlyDigests.createdAt,
    })
    .from(monthlyDigests)
    .where(eq(monthlyDigests.userId, userId))
    .orderBy(desc(monthlyDigests.monthStart))
    .limit(24);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href="/app"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          <span>{t("monthly.back_to_home")}</span>
        </Link>
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("monthly.index_eyebrow")}
          </p>
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] md:text-[28px]">
            {t("monthly.index_title")}
          </h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
            {t("monthly.index_subtitle")}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} strokeWidth={1.75} />}
          title={t("monthly.index_empty_title")}
          description={t("monthly.index_empty_description")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const synthesis = r.synthesis as MonthlySynthesis | null;
            const isoKey = monthStartToIsoKey(r.monthStart);
            const label = formatMonthLabel(isoKey, locale);
            return (
              <Link
                key={r.id}
                href={`/app/digests/monthly/${r.id}`}
                className="group flex flex-col gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 transition-hover hover:border-[hsl(var(--foreground))]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[15px] font-semibold text-[hsl(var(--foreground))]">
                    {label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {synthesis?.themes?.length ?? 0}{" "}
                    {t("monthly.index_themes_label")}
                  </span>
                </div>
                {synthesis?.oneLineSummary ? (
                  <p className="text-[13px] text-[hsl(var(--muted-foreground))] line-clamp-2">
                    {synthesis.oneLineSummary}
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// monthStart is a UTC instant anchored at the user's local 00:00 day-1.
// For the index label, formatting via UTC accessors gives us the right
// ISO month key in the user's tz (since the offset is baked in).
function monthStartToIsoKey(monthStart: Date): string {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
