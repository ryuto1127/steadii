import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  type ActionOption,
  type AgentProposalIssueType,
  type NewAgentProposalRow,
} from "@/lib/db/schema";
import {
  monthlyDigests,
  type NewMonthlyDigestRow,
} from "@/lib/agent/digest/monthly-digests-table";
import { buildDedupKey } from "@/lib/agent/proactive/dedup";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";
import {
  getFromAddress,
  resend,
  ResendNotConfiguredError,
} from "@/lib/integrations/resend/client";
import { logEmailAudit } from "@/lib/agent/email/audit";
import {
  coveredMonthBoundsInTimezone,
  digestExistsFor,
  pickEligibleUsersForMonthlyTick,
} from "@/lib/agent/digest/monthly-picker";
import { buildMonthlyDigest } from "@/lib/agent/digest/monthly-build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-50 — CoS-mode monthly strategic digest cron.
//
// Fires daily at 09:00 UTC. Per-user gate: only the FIRST SUNDAY of the
// covered month in the user's local timezone triggers a build. The
// digest itself covers the prior calendar month (i.e. on May 3 we
// generate the April digest).
//
// For each eligible user:
//   1. Compute month boundaries in user's timezone
//   2. Skip if a monthlyDigests row already exists for that (user, month)
//   3. Run monthly-aggregation → monthly-synthesis
//   4. INSERT row
//   5. Dispatch email via Resend
//   6. Insert a Type C agent_proposal pointing to /app/digests/monthly/{id}
//
// QStash schedule: `0 9 * * *` daily. Sparring updates the canonical
// schedule list in `feedback_qstash_orphan_schedules.md` post-merge.

export async function POST(req: Request) {
  return withHeartbeat("monthly-digest", () =>
    Sentry.startSpan(
      { name: "cron.monthly_digest.daily", op: "cron" },
      async () => {
        const rawBody = await req.text();
        if (!(await verifyQStashSignature(req, rawBody))) {
          return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 }
          );
        }

        const tickAt = new Date();
        const candidates = await pickEligibleUsersForMonthlyTick(tickAt);
        let generated = 0;
        let skipped = 0;
        let failed = 0;

        for (const c of candidates) {
          try {
            const result = await processOneUser({
              userId: c.userId,
              email: c.email,
              timezone: c.timezone,
              now: tickAt,
            });
            if (result === "generated") generated++;
            else if (result === "skipped") skipped++;
          } catch (err) {
            failed++;
            Sentry.captureException(err, {
              tags: { feature: "monthly_digest_cron" },
              user: { id: c.userId },
            });
          }
        }

        return NextResponse.json({
          tickAt: tickAt.toISOString(),
          considered: candidates.length,
          generated,
          skipped,
          failed,
        });
      }
    )
  );
}

// Single-user processor — extracted so the dogfood backdate script can
// call it directly with a synthetic `now`.
export async function processOneUser(args: {
  userId: string;
  email: string;
  timezone: string;
  now: Date;
}): Promise<"generated" | "skipped"> {
  const { userId, timezone, now } = args;
  const { monthStart, monthEnd, isoMonthKey } = coveredMonthBoundsInTimezone(
    now,
    timezone
  );

  const exists = await digestExistsFor(userId, monthStart);
  if (exists) return "skipped";

  const built = await buildMonthlyDigest({
    userId,
    monthStart,
    monthEnd,
    monthLabel: isoMonthKey,
    timezone,
    now,
  });
  if (!built) return "skipped";

  // Suppress when the synthesis is empty (LLM failed and we landed on
  // the fallback). The user gets a re-attempt next month rather than a
  // bare-shell email.
  if (built.synthesis.themes.length === 0 && !built.synthesis.oneLineSummary) {
    return "skipped";
  }

  // 1. Insert the row first — atomic via the unique index, so a
  //    concurrent tick can't double-insert. ON CONFLICT DO NOTHING
  //    falls through cleanly if we just lost the race.
  const row: NewMonthlyDigestRow = {
    userId,
    monthStart,
    aggregate: built.aggregate,
    synthesis: built.synthesis,
  };
  const inserted = await db
    .insert(monthlyDigests)
    .values(row)
    .onConflictDoNothing({
      target: [monthlyDigests.userId, monthlyDigests.monthStart],
    })
    .returning({ id: monthlyDigests.id });
  const digestId = inserted[0]?.id;
  if (!digestId) {
    // Lost the race to a concurrent worker — treat as skipped.
    return "skipped";
  }

  // 2. Dispatch the email. Failure here is non-fatal — we still want
  //    the row + Type C card to land so the in-app surface works.
  try {
    const r = resend();
    const sendResult = await r.emails.send({
      from: getFromAddress(),
      to: args.email,
      subject: built.email.subject,
      html: built.email.html,
      text: built.email.text,
    });
    if (sendResult.error) {
      throw new Error(
        `Resend rejected monthly digest send: ${sendResult.error.name} — ${sendResult.error.message}`
      );
    }
    await db
      .update(monthlyDigests)
      .set({ sentAt: new Date() })
      .where(eq(monthlyDigests.id, digestId));
    await logEmailAudit({
      userId,
      action: "email_ingest_completed",
      result: "success",
      detail: {
        kind: "monthly_digest_sent",
        digestId,
        monthStart: monthStart.toISOString(),
        themeCount: built.synthesis.themes.length,
        recommendationCount: built.synthesis.recommendations.length,
        driftCalloutCount: built.synthesis.driftCallouts.length,
      },
    });
  } catch (err) {
    if (err instanceof ResendNotConfiguredError) {
      // Dev path — keep the row + card, skip the send.
      console.warn(
        "[cron/monthly-digest] RESEND_API_KEY not set; skipping send"
      );
    } else {
      Sentry.captureException(err, {
        tags: { feature: "monthly_digest_cron", phase: "email_send" },
        user: { id: userId },
      });
      try {
        await logEmailAudit({
          userId,
          action: "email_ingest_failed",
          result: "failure",
          detail: {
            kind: "monthly_digest_send_failed",
            digestId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // audit failure is non-fatal
      }
    }
  }

  // 3. Insert the Type C card pointing at the in-app digest page. We
  //    don't fail the cron if this errors — the email is the primary
  //    delivery, the card is a secondary surface.
  try {
    await insertDigestProposal({
      userId,
      digestId,
      oneLineSummary: built.synthesis.oneLineSummary,
      monthLabel: built.email.subject, // already locale-aware
      locale: built.locale,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "monthly_digest_cron", phase: "proposal_insert" },
      user: { id: userId },
    });
  }

  return "generated";
}

async function insertDigestProposal(args: {
  userId: string;
  digestId: string;
  oneLineSummary: string;
  monthLabel: string;
  locale: "en" | "ja";
}): Promise<void> {
  const { userId, digestId, oneLineSummary, locale } = args;
  // Cast for same reason as the issueType assignment below — the enum
  // entry is staged in a sibling edit pending merge.
  const dedupKey = buildDedupKey(
    "monthly_digest" as AgentProposalIssueType,
    [digestId]
  );
  const summary =
    locale === "ja"
      ? `今月の振り返りが届きました${
          oneLineSummary ? ` — ${truncate(oneLineSummary, 100)}` : ""
        }`
      : `Your monthly review is ready${
          oneLineSummary ? ` — ${truncate(oneLineSummary, 100)}` : ""
        }`;
  const reasoning =
    locale === "ja"
      ? "Steadii の Chief of Staff レイヤーが先月の活動を整理しました。テーマ・提案・気になった点が並んでいます。"
      : "Steadii's Chief of Staff layer has finished last month's review — themes, recommendations, and drift callouts surface inside.";
  const actionOptions: ActionOption[] = [
    {
      key: "open_digest",
      label: locale === "ja" ? "詳細を開く" : "Open digest",
      description:
        locale === "ja"
          ? "今月のレビューを開きます。"
          : "Open the full monthly review.",
      tool: "auto",
      payload: {
        digestId,
        op: "open_monthly_digest",
        href: `/app/digests/monthly/${digestId}`,
      },
    },
    {
      key: "dismiss",
      label: locale === "ja" ? "閉じる" : "Dismiss",
      description:
        locale === "ja"
          ? "24 時間非表示にします。"
          : "Hide this notice for 24 hours.",
      tool: "dismiss",
      payload: {},
    },
  ];
  const row: NewAgentProposalRow = {
    userId,
    // engineer-50 — 'monthly_digest' is the new AgentProposalIssueType
    // for this card. The enum addition lives in a sibling edit to
    // lib/db/schema.ts that sparring will apply when collapsing the
    // engineer-49 / engineer-50 PRs; until then, the cast keeps this
    // self-contained without touching the shared schema file.
    issueType: "monthly_digest" as AgentProposalIssueType,
    issueSummary: summary,
    reasoning,
    sourceRefs: [],
    actionOptions,
    dedupKey,
    // Expire after 14 days so an un-acted card doesn't linger across
    // the next month's digest fire.
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  };
  await db
    .insert(agentProposals)
    .values(row)
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
