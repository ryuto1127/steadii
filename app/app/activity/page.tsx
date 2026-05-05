import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Activity as ActivityIcon } from "lucide-react";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import { loadActivityRows, loadActivityStats } from "@/lib/activity/load";
import {
  estimateSecondsSaved,
  formatSecondsSaved,
  formatSecondsSavedJa,
} from "@/lib/digest/time-saved";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import { ActivityStatsCard } from "./_components/activity-stats-card";
import {
  ActivityTimeline,
  groupByDay,
} from "./_components/activity-timeline";
import { ActivityLoadMore } from "./_components/activity-load-more";

export const dynamic = "force-dynamic";

const INITIAL_PAGE_SIZE = 30;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ empty?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  // Dev-only escape hatch: `?empty=1` forces the empty-state branch so the
  // verification screenshot sweep can capture it without needing a fresh
  // user. No-op in production.
  const params = (await searchParams) ?? {};
  const forceEmpty =
    process.env.NODE_ENV !== "production" && params.empty === "1";
  const locale = await getLocale();
  const t = await getTranslations("activity_page");
  const tActions = await getTranslations("home_v2.activity_action_label");

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    initial,
    weekStats,
    monthStats,
    allTimeStats,
    tz,
    [acct],
  ] = await Promise.all([
    loadActivityRows({ userId, limit: INITIAL_PAGE_SIZE }),
    loadActivityStats({ userId, since: weekAgo }),
    loadActivityStats({ userId, since: monthAgo }),
    loadActivityStats({ userId }),
    getUserTimezone(userId),
    db
      .select({ scope: accounts.scope })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
      .limit(1),
  ]);
  const userTz = tz ?? FALLBACK_TZ;
  const gmailConnected = acct?.scope?.includes("gmail") ?? false;

  // Empty state — no audit data yet. Branch on Gmail connection so the
  // CTA is actionable regardless of where the user is in onboarding.
  if (initial.rows.length === 0 || forceEmpty) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <Header
          eyebrow={t("eyebrow")}
          title={t("page_title")}
          subtitle={t("page_subtitle")}
        />
        <div className="mt-10">
          <EmptyState
            icon={<ActivityIcon size={20} strokeWidth={1.75} />}
            title={t("empty_title")}
            description={
              gmailConnected
                ? t("empty_description_connected")
                : t("empty_description_no_gmail")
            }
            actions={
              gmailConnected
                ? undefined
                : [
                    {
                      label: t("empty_cta_connect"),
                      href: "/app/settings",
                    },
                  ]
            }
          />
        </div>
      </div>
    );
  }

  const allTimeSeconds = estimateSecondsSaved({
    archivedCount: allTimeStats.archivedCount,
    draftsSentUnmodified: allTimeStats.draftsSent,
    draftsSentEdited: 0,
    calendarImports: allTimeStats.calendarImports,
    proposalsResolved: allTimeStats.proposalsResolved,
  });
  const timeSavedFormatted =
    locale === "ja"
      ? formatSecondsSavedJa(allTimeSeconds)
      : `~${formatSecondsSaved(allTimeSeconds)}`;

  const groups = groupByDay(initial.rows, {
    todayLabel: t("today"),
    yesterdayLabel: t("yesterday"),
    locale,
    timezone: userTz,
  });

  const actionLabels = {
    draft_sent: tActions("draft_sent"),
    draft_dismissed: tActions("draft_dismissed"),
    auto_archived: tActions("auto_archived"),
    auto_replied: tActions("auto_replied"),
    proposal_resolved: tActions("proposal_resolved"),
    proposal_dismissed: tActions("proposal_dismissed"),
    calendar_imported: tActions("calendar_imported"),
    mistake_added: tActions("mistake_added"),
    generic: tActions("generic"),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Header
        eyebrow={t("eyebrow")}
        title={t("page_title")}
        subtitle={t("page_subtitle")}
      />

      <div className="mt-8">
        <ActivityStatsCard
          thisWeek={{
            label: t("range_this_week"),
            archived: weekStats.archivedCount,
            draftsSent: weekStats.draftsSent,
            proposalsResolved: weekStats.proposalsResolved,
            calendarImports: weekStats.calendarImports,
          }}
          thisMonth={{
            label: t("range_this_month"),
            archived: monthStats.archivedCount,
            draftsSent: monthStats.draftsSent,
            proposalsResolved: monthStats.proposalsResolved,
            calendarImports: monthStats.calendarImports,
          }}
          allTime={{
            label: t("range_all_time"),
            archived: allTimeStats.archivedCount,
            draftsSent: allTimeStats.draftsSent,
            proposalsResolved: allTimeStats.proposalsResolved,
            calendarImports: allTimeStats.calendarImports,
          }}
          timeSavedFormatted={timeSavedFormatted}
          labels={{
            statsHeading: t("stats_heading"),
            timeSaved: t("stat_time_saved"),
            timeSavedCaption: t("stat_time_saved_caption"),
            archivedShort: t("stat_archived_short"),
            draftedShort: t("stat_drafted_short"),
            calendarShort: t("stat_calendar_short"),
          }}
        />
      </div>

      <ActivityTimeline groups={groups} actionLabels={actionLabels} />

      <ActivityLoadMore initialCursor={initial.nextCursor} />
    </div>
  );
}

function Header({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
        {eyebrow}
      </div>
      <h1 className="mt-1 text-h1 text-[hsl(var(--foreground))]">{title}</h1>
      <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
        {subtitle}
      </p>
    </header>
  );
}
