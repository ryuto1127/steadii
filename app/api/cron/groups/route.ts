import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, groupProjectMembers, groupProjects, users } from "@/lib/db/schema";
import { persistGroupDetectionCandidates, persistSilenceProposals } from "@/lib/agent/groups/detect-actions";
import { runGroupSilenceTick, SILENCE_THRESHOLD_DAYS } from "@/lib/agent/groups/silence";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Daily QStash cron — runs (a) auto-detection of new group projects from
// email threads + calendar events, (b) silence detection across all
// active group projects. Recommended schedule: once per day, lined up
// after the digest cron at ~07:30 UTC.
//
// Both passes are bounded — detection is rule-based (no LLM), silence
// is pure SQL. The check-in draft generation that the silence card
// links to is on-demand from the user clicking through.
export async function POST(req: Request) {
  return withHeartbeat("groups", () =>
    Sentry.startSpan(
      { name: "cron.groups.daily", op: "cron" },
      async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const eligibleUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNull(users.deletedAt), isNotNull(users.email)));

      let detectedCreated = 0;
      let detectedSkipped = 0;
      let silentTransitioned = 0;
      let silenceCardsCreated = 0;
      let failed = 0;

      for (const u of eligibleUsers) {
        try {
          const det = await persistGroupDetectionCandidates(u.id);
          detectedCreated += det.created;
          detectedSkipped += det.skipped;
        } catch (err) {
          failed += 1;
          Sentry.captureException(err, {
            tags: { feature: "group_detect_cron" },
            user: { id: u.id },
          });
        }
      }

      try {
        const silenceReport = await runGroupSilenceTick();
        silentTransitioned = silenceReport.membersTransitioned;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "group_silence_tick" },
        });
      }

      // Surface newly-silent members as Type C cards. Pull all (group,
      // member) pairs flagged silent and refresh the proposal table.
      try {
        const silentRows = await db
          .select({
            groupProjectId: groupProjectMembers.groupProjectId,
            email: groupProjectMembers.email,
            name: groupProjectMembers.name,
            lastRespondedAt: groupProjectMembers.lastRespondedAt,
            userId: groupProjects.userId,
            groupTitle: groupProjects.title,
          })
          .from(groupProjectMembers)
          .innerJoin(
            groupProjects,
            eq(groupProjects.id, groupProjectMembers.groupProjectId)
          )
          .where(
            and(
              eq(groupProjectMembers.status, "silent"),
              eq(groupProjects.status, "active")
            )
          );
        // Group by user so we batch the persist call.
        const byUser = new Map<
          string,
          Array<{
            groupProjectId: string;
            memberEmail: string;
            memberName: string | null;
            daysSilent: number;
            groupTitle: string;
          }>
        >();
        const now = Date.now();
        for (const r of silentRows) {
          if (!r.lastRespondedAt) continue;
          const days = Math.floor(
            (now - r.lastRespondedAt.getTime()) / (24 * 60 * 60 * 1000)
          );
          if (days < SILENCE_THRESHOLD_DAYS) continue;
          const list = byUser.get(r.userId) ?? [];
          list.push({
            groupProjectId: r.groupProjectId,
            memberEmail: r.email,
            memberName: r.name,
            daysSilent: days,
            groupTitle: r.groupTitle,
          });
          byUser.set(r.userId, list);
        }
        for (const [uid, list] of byUser) {
          try {
            const result = await persistSilenceProposals(uid, list);
            silenceCardsCreated += result.created;
          } catch (err) {
            Sentry.captureException(err, {
              tags: { feature: "group_silence_persist" },
              user: { id: uid },
            });
          }
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "group_silence_aggregate" },
        });
      }

      // Touch classes here only to silence unused-import check; the daily
      // groups cron may grow class-aware proposals later.
      void classes;

      return NextResponse.json({
        considered: eligibleUsers.length,
        detectedCreated,
        detectedSkipped,
        silentTransitioned,
        silenceCardsCreated,
        failed,
      });
      }
    )
  );
}
