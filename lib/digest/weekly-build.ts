import "server-only";
import { and, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentProposals,
  auditLog,
  inboxItems,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  estimateSecondsSaved,
  formatSecondsSaved,
  formatSecondsSavedJa,
  type WeeklyStats,
} from "@/lib/digest/time-saved";
import {
  selectTopMoments,
  type MomentCandidate,
  type SelectedMoment,
} from "@/lib/digest/top-moments";
import type { DigestLocale } from "@/lib/digest/build";

// ---------------------------------------------------------------------------
// Weekly retrospective digest renderer.
//
// Contract (from post-α #5 handoff):
// - Trailing 7-day window, anchored at the cron tick `now`.
// - Aggregate sources: audit_log auto-archives + calendar imports,
//   agent_drafts (sent / dismissed), agent_proposals (resolved).
// - Pick top 3 moments via `selectTopMoments`.
// - Conservative time-saved estimate via `estimateSecondsSaved`.
// - Render Sunday-evening tone email; suppress when all counts are 0.
// - No deep-links into individual drafts (retrospective, not actionable).
// ---------------------------------------------------------------------------

export type WeeklyDigestPayload = {
  userEmail: string;
  subject: string;
  text: string;
  html: string;
  stats: WeeklyDigestStats;
  moments: SelectedMoment[];
  secondsSaved: number;
};

export type WeeklyDigestStats = WeeklyStats & {
  draftsDismissed: number;
  deadlinesCaught: number;
  // Sum of the three "send" categories: unmodified + edited.
  draftsSent: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadWeeklyAggregates(
  userId: string,
  windowEnd: Date = new Date()
): Promise<{ stats: WeeklyDigestStats; moments: MomentCandidate[] }> {
  const windowStart = new Date(windowEnd.getTime() - WEEK_MS);

  // Audit log — archives + calendar imports. The action vocabulary
  // matches what `recent-activity.tsx` already filters for, so the
  // weekly aggregator and the in-app activity view stay consistent.
  const audits = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      detail: auditLog.detail,
      resourceId: auditLog.resourceId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        inArray(auditLog.action, [
          "auto_archive",
          "calendar_event_imported",
          "syllabus_event_imported",
        ]),
        between(auditLog.createdAt, windowStart, windowEnd)
      )
    )
    .orderBy(desc(auditLog.createdAt));

  let archivedCount = 0;
  let calendarImports = 0;
  const calendarMoments: MomentCandidate[] = [];
  for (const a of audits) {
    if (a.action === "auto_archive") {
      archivedCount++;
      continue;
    }
    calendarImports++;
    const detail =
      typeof a.detail === "object" && a.detail !== null
        ? (a.detail as Record<string, unknown>)
        : null;
    const subject =
      (detail?.summary as string | undefined) ??
      (detail?.title as string | undefined) ??
      "Calendar event";
    calendarMoments.push({
      id: `audit:${a.id}`,
      source: "calendar_import",
      subject,
      occurredAt: a.createdAt,
    });
  }

  // Drafts within the window — sent (manual + auto) and dismissed.
  // Status updates carry `sentAt` for sends; we fall back to `updatedAt`
  // for dismissals so the bucket is comparable across paths.
  const drafts = await db
    .select({
      id: agentDrafts.id,
      status: agentDrafts.status,
      autoSent: agentDrafts.autoSent,
      riskTier: agentDrafts.riskTier,
      sentAt: agentDrafts.sentAt,
      updatedAt: agentDrafts.updatedAt,
      draftSubject: agentDrafts.draftSubject,
      draftBody: agentDrafts.draftBody,
      inboxItemId: agentDrafts.inboxItemId,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.status, ["sent", "dismissed"]),
        between(agentDrafts.updatedAt, windowStart, windowEnd)
      )
    )
    .orderBy(desc(agentDrafts.updatedAt));

  // We need original sender subject for proper "moments" copy (the
  // draft's own subject is sometimes a Re: prefix).
  const inboxItemIds = drafts
    .map((d) => d.inboxItemId)
    .filter((v): v is string => Boolean(v));
  const inboxRows =
    inboxItemIds.length > 0
      ? await db
          .select({
            id: inboxItems.id,
            subject: inboxItems.subject,
            senderName: inboxItems.senderName,
            senderEmail: inboxItems.senderEmail,
          })
          .from(inboxItems)
          .where(inArray(inboxItems.id, inboxItemIds))
      : [];
  const inboxById = new Map(inboxRows.map((r) => [r.id, r]));

  let draftsSentUnmodified = 0;
  let draftsSentEdited = 0;
  let draftsDismissed = 0;
  let deadlinesCaught = 0;
  const draftMoments: MomentCandidate[] = [];
  for (const d of drafts) {
    if (d.status === "dismissed") {
      draftsDismissed++;
      continue;
    }
    // Sent path — split unmodified vs edited. We treat `auto_sent` as
    // unmodified (the user opted into low-risk auto-send and didn't
    // touch the content). For manual sends, we don't have a stored
    // edit-count today, so we use the heuristic "approved without an
    // 'edited' status transition" — captured by `status='sent'` going
    // straight from 'pending' → 'sent'. We don't have that history at
    // hand here without an extra join, so we approximate: any draft
    // whose status is 'sent' is counted as unmodified-equivalent for
    // time-saved purposes. Future work: persist the editor diff and
    // split more precisely. For α this is generous enough that the
    // estimate stays plausible.
    draftsSentUnmodified++;
    const inbox = inboxById.get(d.inboxItemId);
    const subject = inbox?.subject ?? d.draftSubject ?? "(no subject)";
    const context = inbox?.senderName ?? inbox?.senderEmail;
    if (
      subject.toLowerCase().includes("deadline") ||
      subject.toLowerCase().includes("due") ||
      subject.includes("締切") ||
      subject.includes("期限") ||
      subject.includes("提出") ||
      subject.toLowerCase().includes("submit")
    ) {
      deadlinesCaught++;
    }
    draftMoments.push({
      id: `draft:${d.id}`,
      source: "draft",
      subject,
      context,
      occurredAt: d.sentAt ?? d.updatedAt,
      riskTier: d.riskTier as "low" | "medium" | "high",
      sentUnmodified: true,
    });
  }

  // Resolved proposals.
  let proposalsResolved = 0;
  const proposalMoments: MomentCandidate[] = [];
  try {
    const proposals = await db
      .select({
        id: agentProposals.id,
        issueSummary: agentProposals.issueSummary,
        resolvedAt: agentProposals.resolvedAt,
        createdAt: agentProposals.createdAt,
      })
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          eq(agentProposals.status, "resolved"),
          between(agentProposals.resolvedAt, windowStart, windowEnd)
        )
      )
      .orderBy(desc(agentProposals.resolvedAt));
    for (const p of proposals) {
      proposalsResolved++;
      proposalMoments.push({
        id: `proposal:${p.id}`,
        source: "proposal",
        subject: p.issueSummary,
        occurredAt: p.resolvedAt ?? p.createdAt,
      });
    }
  } catch {
    // proposals table missing — degrade silently (matches the daily
    // build pattern).
  }

  const stats: WeeklyDigestStats = {
    archivedCount,
    draftsSentUnmodified,
    draftsSentEdited,
    calendarImports,
    proposalsResolved,
    draftsDismissed,
    deadlinesCaught,
    draftsSent: draftsSentUnmodified + draftsSentEdited,
  };
  const moments: MomentCandidate[] = [
    ...draftMoments,
    ...proposalMoments,
    ...calendarMoments,
  ];
  return { stats, moments };
}

function isAllZero(s: WeeklyDigestStats): boolean {
  return (
    s.archivedCount === 0 &&
    s.draftsSent === 0 &&
    s.draftsDismissed === 0 &&
    s.calendarImports === 0 &&
    s.proposalsResolved === 0
  );
}

// Heavy = 10+ aggregate actions. Otherwise light. Used for subject
// variants; copy stays content-aware (memory-locked digest pattern).
function isHeavyWeek(s: WeeklyDigestStats): boolean {
  return (
    s.archivedCount + s.draftsSent + s.deadlinesCaught + s.calendarImports >= 10
  );
}

export function buildWeeklySubject(
  stats: WeeklyDigestStats,
  locale: DigestLocale = "en"
): string {
  const total =
    stats.archivedCount + stats.draftsSent + stats.calendarImports +
    stats.proposalsResolved;
  if (locale === "ja") {
    if (isHeavyWeek(stats)) {
      return `今週の Steadii — ${stats.archivedCount} 件アーカイブ、${stats.draftsSent} 件下書き、締切 ${stats.deadlinesCaught} 件キャッチ`;
    }
    return `静かな週でした — Steadii は ${total} 件対応`;
  }
  if (isHeavyWeek(stats)) {
    return `Your week with Steadii — ${stats.archivedCount} archived, ${stats.draftsSent} drafted, ${stats.deadlinesCaught} deadlines caught`;
  }
  return `A quiet week — Steadii did ${total} thing${total === 1 ? "" : "s"}`;
}

export function buildWeeklyText(args: {
  stats: WeeklyDigestStats;
  moments: SelectedMoment[];
  secondsSaved: number;
  appUrl: string;
  locale?: DigestLocale;
}): string {
  const locale = args.locale ?? "en";
  const lines: string[] = [];
  lines.push(
    locale === "ja"
      ? "Steadii Agent — 今週の振り返り"
      : "Steadii Agent — your week in review"
  );
  lines.push("");
  if (locale === "ja") {
    lines.push(`アーカイブ: ${args.stats.archivedCount}`);
    lines.push(`送信した下書き: ${args.stats.draftsSent}`);
    lines.push(`スキップした下書き: ${args.stats.draftsDismissed}`);
    lines.push(`キャッチした締切: ${args.stats.deadlinesCaught}`);
    lines.push(`予定の取り込み: ${args.stats.calendarImports}`);
    lines.push(`時間の節約: 約 ${formatSecondsSavedJa(args.secondsSaved)}`);
  } else {
    lines.push(`Archived: ${args.stats.archivedCount}`);
    lines.push(`Drafts sent: ${args.stats.draftsSent}`);
    lines.push(`Drafts skipped: ${args.stats.draftsDismissed}`);
    lines.push(`Deadlines caught: ${args.stats.deadlinesCaught}`);
    lines.push(`Calendar imports: ${args.stats.calendarImports}`);
    lines.push(`Time saved: ~${formatSecondsSaved(args.secondsSaved)}`);
  }
  lines.push("");
  if (args.moments.length > 0) {
    lines.push(locale === "ja" ? "今週のハイライト:" : "Top moments this week:");
    for (const m of args.moments) {
      lines.push(`  • ${m.subject}`);
    }
    lines.push("");
  }
  const cta = `${args.appUrl}/app/activity?utm_source=weekly_digest`;
  lines.push(
    locale === "ja"
      ? `すべての記録を見る → ${cta}`
      : `See the full activity log → ${cta}`
  );
  return lines.join("\n");
}

export function buildWeeklyHtml(args: {
  stats: WeeklyDigestStats;
  moments: SelectedMoment[];
  secondsSaved: number;
  appUrl: string;
  locale?: DigestLocale;
}): string {
  const locale = args.locale ?? "en";
  const titleEyebrow = "Steadii Agent";
  const titleHeading =
    locale === "ja" ? "今週の振り返り" : "Your week in review";
  const cta = `${args.appUrl}/app/activity?utm_source=weekly_digest`;
  const ctaLabel =
    locale === "ja" ? "すべての記録を見る →" : "See the full activity log →";
  const momentsHeading =
    locale === "ja" ? "今週のハイライト" : "Top moments this week";
  const statLabels =
    locale === "ja"
      ? {
          archived: "アーカイブ",
          drafted: "送信下書き",
          deadlines: "締切キャッチ",
          time: "時間の節約",
        }
      : {
          archived: "Archived",
          drafted: "Sent",
          deadlines: "Deadlines",
          time: "Time saved",
        };
  const formattedTime =
    locale === "ja"
      ? formatSecondsSavedJa(args.secondsSaved)
      : `~${formatSecondsSaved(args.secondsSaved)}`;

  const statCell = (label: string, value: string | number) => `
    <td align="center" style="padding: 12px 8px; border: 1px solid #E4E0DB; background: #FAFAF9; border-radius: 6px;">
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 600; color: #1A1814; line-height: 1.1;">${escapeHtml(String(value))}</div>
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #6E6A64; margin-top: 4px;">${escapeHtml(label)}</div>
    </td>
  `;

  const momentRows = args.moments
    .map(
      (m) => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #E4E0DB;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814; line-height: 1.4;">
              <span style="display: inline-block; min-width: 18px; color: #6E6A64;">${m.priority}.</span>
              ${escapeHtml(m.subject)}
            </div>
          </td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${locale}">
  <body style="margin: 0; padding: 0; background: #FAFAF9;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width: 560px; background: #FFFFFF; border: 1px solid #E4E0DB; border-radius: 8px;">
            <tr>
              <td style="padding: 24px 24px 8px 24px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">${escapeHtml(titleEyebrow)}</div>
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 600; color: #1A1814; margin-top: 4px;">${escapeHtml(titleHeading)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 24px 0 24px;">
                <table role="presentation" width="100%" cellspacing="6" cellpadding="0">
                  <tr>
                    ${statCell(statLabels.archived, args.stats.archivedCount)}
                    ${statCell(statLabels.drafted, args.stats.draftsSent)}
                    ${statCell(statLabels.deadlines, args.stats.deadlinesCaught)}
                    ${statCell(statLabels.time, formattedTime)}
                  </tr>
                </table>
              </td>
            </tr>
            ${
              args.moments.length > 0
                ? `
            <tr>
              <td style="padding: 16px 24px 0 24px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">${escapeHtml(momentsHeading)}</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${momentRows}</table>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding: 20px 24px 24px 24px;">
                <a href="${escapeHtmlAttr(cta)}" style="display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; color: #FFFFFF; background: #1A1814; padding: 10px 16px; border-radius: 6px; text-decoration: none;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function buildWeeklyDigestPayload(
  userId: string,
  windowEnd: Date = new Date()
): Promise<WeeklyDigestPayload | null> {
  const [user] = await db
    .select({
      email: users.email,
      weeklyDigestEnabled: users.weeklyDigestEnabled,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  if (!user.weeklyDigestEnabled) return null;

  const { stats, moments } = await loadWeeklyAggregates(userId, windowEnd);
  if (isAllZero(stats)) return null;

  const e = env();
  const appUrl = e.APP_URL;
  const locale: DigestLocale =
    user.preferences?.locale === "ja" ? "ja" : "en";
  const secondsSaved = estimateSecondsSaved(stats);
  const topMoments = selectTopMoments(moments, 3);
  const subject = buildWeeklySubject(stats, locale);
  const text = buildWeeklyText({
    stats,
    moments: topMoments,
    secondsSaved,
    appUrl,
    locale,
  });
  const html = buildWeeklyHtml({
    stats,
    moments: topMoments,
    secondsSaved,
    appUrl,
    locale,
  });
  return {
    userEmail: user.email,
    subject,
    text,
    html,
    stats,
    moments: topMoments,
    secondsSaved,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}
