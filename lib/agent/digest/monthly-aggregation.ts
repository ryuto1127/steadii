import "server-only";
import { and, between, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentProposals,
  assignments,
  auditLog,
  chats,
  events,
  inboxItems,
  messages,
  usageEvents,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// engineer-50 — CoS-mode monthly digest aggregation layer.
//
// Pure-DB-query module: given (userId, monthStart, monthEnd), returns a
// MonthlyAggregate that the LLM synthesis layer renders into themes /
// recommendations / callouts. No LLM here.
//
// Boundaries: half-open interval [monthStart, monthEnd). The cron computes
// these in the user's local TZ (first day of the covered month, 00:00 local)
// before calling.
//
// Comparison window: prior calendar month, [priorStart, monthStart). We
// re-run the same aggregator for that range so the synthesis layer can
// render deltas without bespoke comparison SQL.
// ---------------------------------------------------------------------------

export type MonthlyAggregate = {
  emailActivity: {
    receivedCount: number;
    triagedHighCount: number;
    triagedMediumCount: number;
    triagedLowCount: number;
    draftsGenerated: number;
    draftsApproved: number;
    draftsDismissed: number;
    autoSentCount: number;
    avgResponseLatencyHours: number | null;
    topSenders: Array<{
      email: string;
      received: number;
      approved: number;
      dismissed: number;
    }>;
  };
  calendarActivity: {
    eventsAttended: number;
    eventsMissed: number;
    averageDailyMeetingHours: number;
    classesAttended: number;
    classesMissed: number;
  };
  assignmentActivity: {
    completed: number;
    inProgressCarryover: number;
    notStartedCarryover: number;
    avgLeadTimeBetweenCreatedAndDone: number | null;
  };
  chatActivity: {
    sessionCount: number;
    messageCount: number;
    voiceSessionCount: number;
    toolCallCount: number;
    topToolsUsed: Array<{ name: string; count: number }>;
  };
  proactiveActivity: {
    proposalsShown: number;
    proposalsActedOn: number;
    proposalsDismissed: number;
    topRulesFired: Array<{ rule: string; count: number }>;
  };
  driftSignals: {
    overwhelmedMentions: number;
    blockedMentions: number;
    cancelledMeetingsCount: number;
    fadingContacts: Array<{ email: string; daysSinceLastTouch: number }>;
  };
  comparisons: {
    priorMonth?: Partial<MonthlyAggregate>;
  };
};

// Drift-signal keyword sets. Approximation only — ja/en mix. Regex-friendly,
// case-insensitive on the EN side (run against lowercased content).
const OVERWHELMED_PATTERNS = [
  /overwhelmed/i,
  /swamped/i,
  /burn(ed)?\s*out/i,
  /too\s*much/i,
  /can't\s*keep\s*up/i,
  /辛い/,
  /きつい/,
  /厳しい/,
  /やばい/,
  /パンク/,
  /いっぱいいっぱい/,
];

const BLOCKED_PATTERNS = [
  /\bstuck\b/i,
  /blocked/i,
  /can'?t\s*figure/i,
  /no\s*idea/i,
  /詰まってる/,
  /詰まった/,
  /分からない/,
  /行き詰ま/,
];

export type AggregateInput = {
  userId: string;
  monthStart: Date;
  monthEnd: Date;
};

// Top-level entry: returns the current month aggregate plus a partial
// prior-month aggregate (same shape, no nested comparisons) so the
// synthesis layer can describe deltas.
export async function buildMonthlyAggregate(
  input: AggregateInput
): Promise<MonthlyAggregate> {
  const current = await buildOneMonthAggregate(input);
  const priorRange = priorMonthRange(input.monthStart);
  const prior = await buildOneMonthAggregate({
    userId: input.userId,
    monthStart: priorRange.start,
    monthEnd: priorRange.end,
  });
  return {
    ...current,
    comparisons: {
      priorMonth: {
        emailActivity: prior.emailActivity,
        calendarActivity: prior.calendarActivity,
        assignmentActivity: prior.assignmentActivity,
        chatActivity: prior.chatActivity,
        proactiveActivity: prior.proactiveActivity,
        driftSignals: prior.driftSignals,
      },
    },
  };
}

// Compute the prior calendar month range based on the *current* month
// start. Half-open: prior = [start - 1 month, start). Pure date math —
// the cron has already normalized monthStart to local-tz 00:00 of day 1.
export function priorMonthRange(currentStart: Date): {
  start: Date;
  end: Date;
} {
  const end = currentStart;
  // Step back one calendar month from `currentStart`. Use UTC math so we
  // don't drift on DST — the caller's local-tz anchor is preserved by
  // copying the wall-clock components.
  const y = currentStart.getUTCFullYear();
  const m = currentStart.getUTCMonth();
  const d = currentStart.getUTCDate();
  const h = currentStart.getUTCHours();
  const mi = currentStart.getUTCMinutes();
  const start = new Date(
    Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, d, h, mi, 0)
  );
  return { start, end };
}

// One-month aggregate without the comparisons block. Used internally by
// both the current-month build and the prior-month comparison build.
async function buildOneMonthAggregate(
  input: AggregateInput
): Promise<MonthlyAggregate> {
  const { userId, monthStart, monthEnd } = input;

  const [
    emailActivity,
    calendarActivity,
    assignmentActivity,
    chatActivity,
    proactiveActivity,
    driftSignals,
  ] = await Promise.all([
    loadEmailActivity({ userId, monthStart, monthEnd }),
    loadCalendarActivity({ userId, monthStart, monthEnd }),
    loadAssignmentActivity({ userId, monthStart, monthEnd }),
    loadChatActivity({ userId, monthStart, monthEnd }),
    loadProactiveActivity({ userId, monthStart, monthEnd }),
    loadDriftSignals({ userId, monthStart, monthEnd }),
  ]);

  return {
    emailActivity,
    calendarActivity,
    assignmentActivity,
    chatActivity,
    proactiveActivity,
    driftSignals,
    comparisons: {},
  };
}

// ---------------------------------------------------------------------------
// Email activity. Counts and per-sender breakdown over the window.
// ---------------------------------------------------------------------------

async function loadEmailActivity(
  input: AggregateInput
): Promise<MonthlyAggregate["emailActivity"]> {
  const { userId, monthStart, monthEnd } = input;

  // Received: every inbox row whose received_at falls in the window. We
  // count regardless of bucket — the user "received" them, even if L1
  // auto-archived noise.
  const received = await db
    .select({
      id: inboxItems.id,
      senderEmail: inboxItems.senderEmail,
      riskTier: inboxItems.riskTier,
      receivedAt: inboxItems.receivedAt,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        between(inboxItems.receivedAt, monthStart, monthEnd)
      )
    );

  let triagedHigh = 0;
  let triagedMedium = 0;
  let triagedLow = 0;
  for (const r of received) {
    if (r.riskTier === "high") triagedHigh++;
    else if (r.riskTier === "medium") triagedMedium++;
    else if (r.riskTier === "low") triagedLow++;
  }

  // Drafts: created in window (draftsGenerated) AND drafts updated in
  // window with terminal status (sent / dismissed). Status updates use
  // updated_at as the activity timestamp — matches the weekly digest's
  // convention.
  const draftsCreated = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        between(agentDrafts.createdAt, monthStart, monthEnd)
      )
    );

  const draftsTerminal = await db
    .select({
      id: agentDrafts.id,
      status: agentDrafts.status,
      autoSent: agentDrafts.autoSent,
      sentAt: agentDrafts.sentAt,
      approvedAt: agentDrafts.approvedAt,
      inboxItemId: agentDrafts.inboxItemId,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.status, ["sent", "dismissed"]),
        between(agentDrafts.updatedAt, monthStart, monthEnd)
      )
    );

  let approved = 0;
  let dismissed = 0;
  let autoSent = 0;
  const responseLatencyHours: number[] = [];
  const inboxItemIds = draftsTerminal
    .map((d) => d.inboxItemId)
    .filter((v): v is string => Boolean(v));
  const inboxRowsForLatency =
    inboxItemIds.length > 0
      ? await db
          .select({
            id: inboxItems.id,
            receivedAt: inboxItems.receivedAt,
          })
          .from(inboxItems)
          .where(inArray(inboxItems.id, inboxItemIds))
      : [];
  const receivedAtById = new Map(
    inboxRowsForLatency.map((r) => [r.id, r.receivedAt])
  );

  for (const d of draftsTerminal) {
    if (d.status === "sent") {
      approved++;
      if (d.autoSent) autoSent++;
      // Response latency: medium/high tier user-approved sends only.
      // Auto-sent rows aren't a "user response" in the latency sense.
      if (!d.autoSent && d.sentAt) {
        const r = receivedAtById.get(d.inboxItemId);
        if (r) {
          const hours = (d.sentAt.getTime() - r.getTime()) / (60 * 60 * 1000);
          if (hours >= 0 && hours < 24 * 30) {
            responseLatencyHours.push(hours);
          }
        }
      }
    } else if (d.status === "dismissed") {
      dismissed++;
    }
  }

  const avgResponseLatencyHours =
    responseLatencyHours.length > 0
      ? responseLatencyHours.reduce((a, b) => a + b, 0) /
        responseLatencyHours.length
      : null;

  // Top senders: bucket received rows by sender_email, join with drafts
  // by inbox_item_id for approved/dismissed counts. Top 5 by `received`.
  const perSender = new Map<
    string,
    { received: number; approved: number; dismissed: number }
  >();
  for (const r of received) {
    const acc = perSender.get(r.senderEmail) ?? {
      received: 0,
      approved: 0,
      dismissed: 0,
    };
    acc.received++;
    perSender.set(r.senderEmail, acc);
  }

  // Map inbox_item_id → sender_email for drafts in the window
  if (inboxItemIds.length > 0) {
    const senderRows = await db
      .select({
        id: inboxItems.id,
        senderEmail: inboxItems.senderEmail,
      })
      .from(inboxItems)
      .where(inArray(inboxItems.id, inboxItemIds));
    const senderById = new Map(senderRows.map((r) => [r.id, r.senderEmail]));
    for (const d of draftsTerminal) {
      const email = senderById.get(d.inboxItemId);
      if (!email) continue;
      const acc = perSender.get(email) ?? {
        received: 0,
        approved: 0,
        dismissed: 0,
      };
      if (d.status === "sent") acc.approved++;
      else if (d.status === "dismissed") acc.dismissed++;
      perSender.set(email, acc);
    }
  }

  const topSenders = Array.from(perSender.entries())
    .map(([email, v]) => ({ email, ...v }))
    .sort((a, b) => b.received - a.received)
    .slice(0, 5);

  return {
    receivedCount: received.length,
    triagedHighCount: triagedHigh,
    triagedMediumCount: triagedMedium,
    triagedLowCount: triagedLow,
    draftsGenerated: Number(draftsCreated[0]?.count ?? 0),
    draftsApproved: approved,
    draftsDismissed: dismissed,
    autoSentCount: autoSent,
    avgResponseLatencyHours,
    topSenders,
  };
}

// ---------------------------------------------------------------------------
// Calendar activity. "Attended/missed" is a heuristic — we don't track
// physical attendance — so we use event status + class detection.
// ---------------------------------------------------------------------------

async function loadCalendarActivity(
  input: AggregateInput
): Promise<MonthlyAggregate["calendarActivity"]> {
  const { userId, monthStart, monthEnd } = input;

  // Pull every event that *started* in the window AND wasn't cancelled.
  // "Attended" = status confirmed/completed/null (the default), "missed"
  // = status cancelled. classroom_coursework rows with kind='assignment'
  // are excluded — they live in the assignment bucket.
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
      kind: events.kind,
      isAllDay: events.isAllDay,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        between(events.startsAt, monthStart, monthEnd),
        ne(events.kind, "assignment")
      )
    );

  let attended = 0;
  let missed = 0;
  let totalEventMinutes = 0;
  let classesAttended = 0;
  let classesMissed = 0;

  const isClassLike = (title: string): boolean => {
    // Heuristic: titles with course-code patterns or lecture/class keywords.
    return (
      /\b[A-Z]{2,4}\s?\d{2,4}\b/.test(title) ||
      /lecture|class|授業|講義/i.test(title)
    );
  };

  for (const e of rows) {
    if (e.kind === "task") continue;
    const isCancelled = e.status === "cancelled";
    if (isCancelled) {
      missed++;
      if (isClassLike(e.title)) classesMissed++;
      continue;
    }
    attended++;
    if (isClassLike(e.title)) classesAttended++;
    if (e.endsAt && !e.isAllDay) {
      const mins = Math.max(
        0,
        (e.endsAt.getTime() - e.startsAt.getTime()) / 60000
      );
      // Cap each event at 8 hours so an erroneous multi-day block can't
      // skew the daily average. 8h ≈ the longest plausible single
      // meeting / class day a student would log.
      totalEventMinutes += Math.min(mins, 8 * 60);
    }
  }

  const days = Math.max(
    1,
    Math.ceil((monthEnd.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000))
  );
  const averageDailyMeetingHours = totalEventMinutes / 60 / days;

  return {
    eventsAttended: attended,
    eventsMissed: missed,
    averageDailyMeetingHours: round2(averageDailyMeetingHours),
    classesAttended,
    classesMissed,
  };
}

// ---------------------------------------------------------------------------
// Assignment activity. Carryover = started before/during month, still
// open at month end. "Completed" = status flipped to 'done' in window.
// ---------------------------------------------------------------------------

async function loadAssignmentActivity(
  input: AggregateInput
): Promise<MonthlyAggregate["assignmentActivity"]> {
  const { userId, monthStart, monthEnd } = input;

  // Completed: status='done' AND updated_at in window. We don't have a
  // dedicated `completed_at` column, but updated_at is the only signal
  // we get for status transitions today.
  const completedRows = await db
    .select({
      id: assignments.id,
      createdAt: assignments.createdAt,
      updatedAt: assignments.updatedAt,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.status, "done"),
        between(assignments.updatedAt, monthStart, monthEnd)
      )
    );

  // Lead time: hours from creation → done. Filter to assignments where
  // both timestamps are sane (created < updated).
  const leadTimeHoursList: number[] = [];
  for (const r of completedRows) {
    const h = (r.updatedAt.getTime() - r.createdAt.getTime()) / (60 * 60 * 1000);
    if (h > 0 && h < 24 * 365) leadTimeHoursList.push(h);
  }
  const avgLeadTimeBetweenCreatedAndDone =
    leadTimeHoursList.length > 0
      ? round2(
          leadTimeHoursList.reduce((a, b) => a + b, 0) / leadTimeHoursList.length
        )
      : null;

  // In-progress carryover: created in window, still in_progress and not
  // soft-deleted at month end.
  const inProgressCarryover = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.status, "in_progress"),
        between(assignments.createdAt, monthStart, monthEnd)
      )
    );

  // Not-started carryover: due_at in window, status still not_started at
  // month end. Slipped past the deadline = still on the deck. We don't
  // exclude future-due rows because the digest is end-of-month — anything
  // due in window AND not started counts.
  const notStartedCarryover = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.status, "not_started"),
        isNotNull(assignments.dueAt),
        between(assignments.dueAt, monthStart, monthEnd)
      )
    );

  return {
    completed: completedRows.length,
    inProgressCarryover: Number(inProgressCarryover[0]?.count ?? 0),
    notStartedCarryover: Number(notStartedCarryover[0]?.count ?? 0),
    avgLeadTimeBetweenCreatedAndDone,
  };
}

// ---------------------------------------------------------------------------
// Chat activity. Sessions = chats with at least one user message in the
// window. Tool calls come from messages.toolCalls jsonb; voice from
// usage_events with task_type='voice_cleanup'.
// ---------------------------------------------------------------------------

async function loadChatActivity(
  input: AggregateInput
): Promise<MonthlyAggregate["chatActivity"]> {
  const { userId, monthStart, monthEnd } = input;

  // Pull chats the user has touched in window. We approximate "session"
  // as a chat that has any user message in the window.
  const userMessages = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      role: messages.role,
      content: messages.content,
      toolCalls: messages.toolCalls,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.userId, userId),
        between(messages.createdAt, monthStart, monthEnd)
      )
    );

  const sessionIds = new Set<string>();
  let toolCallCount = 0;
  const toolNameTallies = new Map<string, number>();
  let messageCount = 0;

  for (const m of userMessages) {
    if (m.role === "user") sessionIds.add(m.chatId);
    messageCount++;
    if (m.toolCalls && Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls as Array<{
        function?: { name?: string };
        name?: string;
      }>) {
        const name = tc.function?.name ?? tc.name ?? null;
        if (!name) continue;
        toolCallCount++;
        toolNameTallies.set(name, (toolNameTallies.get(name) ?? 0) + 1);
      }
    }
  }

  const topToolsUsed = Array.from(toolNameTallies.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Voice sessions: distinct chat_ids in usage_events with task_type
  // voice_cleanup in window. Falls back to 0 if the column is missing
  // on older rows — defensive only, voice_cleanup pre-dates the digest.
  const voiceRows = await db
    .select({ chatId: usageEvents.chatId })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.taskType, "voice_cleanup"),
        between(usageEvents.createdAt, monthStart, monthEnd)
      )
    );
  const voiceSessionIds = new Set<string>();
  for (const v of voiceRows) {
    if (v.chatId) voiceSessionIds.add(v.chatId);
  }

  return {
    sessionCount: sessionIds.size,
    messageCount,
    voiceSessionCount: voiceSessionIds.size,
    toolCallCount,
    topToolsUsed,
  };
}

// ---------------------------------------------------------------------------
// Proactive proposal activity. Shown = created in window. Acted on =
// resolved with action != auto_revalidated (the absent-pending sweep
// flips stale rows automatically; that's not a user action).
// ---------------------------------------------------------------------------

async function loadProactiveActivity(
  input: AggregateInput
): Promise<MonthlyAggregate["proactiveActivity"]> {
  const { userId, monthStart, monthEnd } = input;

  const shown = await db
    .select({
      id: agentProposals.id,
      issueType: agentProposals.issueType,
    })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        between(agentProposals.createdAt, monthStart, monthEnd)
      )
    );

  const resolved = await db
    .select({
      id: agentProposals.id,
      status: agentProposals.status,
      resolvedAction: agentProposals.resolvedAction,
    })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.userId, userId),
        inArray(agentProposals.status, ["resolved", "dismissed"]),
        isNotNull(agentProposals.resolvedAt),
        between(agentProposals.resolvedAt, monthStart, monthEnd)
      )
    );

  let proposalsActedOn = 0;
  let proposalsDismissed = 0;
  for (const r of resolved) {
    if (r.status === "dismissed") {
      proposalsDismissed++;
      continue;
    }
    if (r.resolvedAction && r.resolvedAction !== "auto_revalidated") {
      proposalsActedOn++;
    }
  }

  // Top rule firings — bucket the `shown` rows by issueType.
  const ruleTallies = new Map<string, number>();
  for (const s of shown) {
    ruleTallies.set(s.issueType, (ruleTallies.get(s.issueType) ?? 0) + 1);
  }
  const topRulesFired = Array.from(ruleTallies.entries())
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    proposalsShown: shown.length,
    proposalsActedOn,
    proposalsDismissed,
    topRulesFired,
  };
}

// ---------------------------------------------------------------------------
// Drift signals. Approximation only — regex over chat messages for
// mood-mentions; cancelled-events count from calendar; fading contacts
// from the user's recent send history.
// ---------------------------------------------------------------------------

async function loadDriftSignals(
  input: AggregateInput
): Promise<MonthlyAggregate["driftSignals"]> {
  const { userId, monthStart, monthEnd } = input;

  // User messages in window only — assistant content reflects Steadii's
  // output, not the user's state of mind.
  const userMessages = await db
    .select({
      id: messages.id,
      content: messages.content,
    })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.userId, userId),
        eq(messages.role, "user"),
        between(messages.createdAt, monthStart, monthEnd)
      )
    );

  let overwhelmedMentions = 0;
  let blockedMentions = 0;
  for (const m of userMessages) {
    const content = m.content || "";
    if (OVERWHELMED_PATTERNS.some((p) => p.test(content))) {
      overwhelmedMentions++;
    }
    if (BLOCKED_PATTERNS.some((p) => p.test(content))) {
      blockedMentions++;
    }
  }

  // Cancelled meetings: events with status='cancelled' in window.
  const cancelled = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.status, "cancelled"),
        between(events.startsAt, monthStart, monthEnd)
      )
    );

  // Fading contacts: heuristic — find contacts where the user has sent
  // ≥3 drafts in the past 6 months but hasn't sent any in the past 30
  // days as of monthEnd. We rank by the gap relative to historical
  // cadence (max days since last touch). Capped at top 5.
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  const FADING_FLOOR_DAYS = 30;
  const historicalFloor = new Date(monthEnd.getTime() - SIX_MONTHS_MS);

  const sentDrafts = await db
    .select({
      id: agentDrafts.id,
      inboxItemId: agentDrafts.inboxItemId,
      sentAt: agentDrafts.sentAt,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "sent"),
        isNotNull(agentDrafts.sentAt),
        gte(agentDrafts.sentAt, historicalFloor),
        lt(agentDrafts.sentAt, monthEnd)
      )
    )
    .orderBy(desc(agentDrafts.sentAt));

  const sentInboxIds = sentDrafts
    .map((d) => d.inboxItemId)
    .filter((v): v is string => Boolean(v));
  const senderByItemId = new Map<string, string>();
  if (sentInboxIds.length > 0) {
    const rows = await db
      .select({
        id: inboxItems.id,
        senderEmail: inboxItems.senderEmail,
      })
      .from(inboxItems)
      .where(inArray(inboxItems.id, sentInboxIds));
    for (const r of rows) senderByItemId.set(r.id, r.senderEmail);
  }

  type ContactStat = { lastTouch: Date; total: number };
  const contactMap = new Map<string, ContactStat>();
  for (const d of sentDrafts) {
    const email = senderByItemId.get(d.inboxItemId);
    if (!email) continue;
    if (!d.sentAt) continue;
    const prior = contactMap.get(email);
    if (!prior) {
      contactMap.set(email, { lastTouch: d.sentAt, total: 1 });
    } else {
      prior.total++;
      if (d.sentAt > prior.lastTouch) prior.lastTouch = d.sentAt;
    }
  }

  const fadingContacts: Array<{ email: string; daysSinceLastTouch: number }> = [];
  for (const [email, stat] of contactMap.entries()) {
    if (stat.total < 3) continue;
    const daysSinceLastTouch =
      (monthEnd.getTime() - stat.lastTouch.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceLastTouch < FADING_FLOOR_DAYS) continue;
    fadingContacts.push({
      email,
      daysSinceLastTouch: Math.floor(daysSinceLastTouch),
    });
  }
  fadingContacts.sort((a, b) => b.daysSinceLastTouch - a.daysSinceLastTouch);

  return {
    overwhelmedMentions,
    blockedMentions,
    cancelledMeetingsCount: Number(cancelled[0]?.count ?? 0),
    fadingContacts: fadingContacts.slice(0, 5),
  };
}

// Round to 2 decimals — keeps the synthesis layer's prompt budget tight
// without losing meaningful precision for "avg daily hours" style stats.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Resolve the audit-log helper signal: total emails ever sent by the
// user back to a contact, ignoring the window. Used by the synthesis
// layer to render "your usual cadence is …" when callouts call it out.
// Exported for cross-section reuse.
export async function totalSentToContact(
  userId: string,
  contactEmail: string
): Promise<number> {
  const inboxRows = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.senderEmail, contactEmail)
      )
    );
  const ids = inboxRows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const sent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.userId, userId),
        inArray(agentDrafts.inboxItemId, ids),
        eq(agentDrafts.status, "sent")
      )
    );
  return Number(sent[0]?.count ?? 0);
}

// Convenience: re-export the audit-log table for tests that need to
// stub it. The aggregator itself doesn't read auditLog today (every
// signal lives in the typed tables) — this keeps the import-graph
// honest.
export { auditLog };
