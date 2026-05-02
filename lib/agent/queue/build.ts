import "server-only";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentProposals,
  inboxItems,
  type ActionOption,
  type AgentDraft,
  type AgentProposalIssueType,
  type AgentProposalRow,
  type ProposalSourceRef,
  type RetrievalProvenance,
} from "@/lib/db/schema";
import {
  QUEUE_FETCH_LIMIT,
  type QueueCard,
  type QueueCardA,
  type QueueCardB,
  type QueueCardC,
  type QueueCardE,
  type QueueConfidence,
  type QueueDecisionOption,
  type QueueSourceChip,
} from "./types";

// ── Public API ───────────────────────────────────────────────────────

export async function buildQueueForUser(userId: string): Promise<QueueCard[]> {
  // We pull more than the visible cap so the "Show more" expansion has
  // material — the page-level collapse logic is what trims the visible
  // count to QUEUE_VISIBLE_LIMIT.
  const [proposalRows, draftRows] = await Promise.all([
    fetchPendingProposals(userId),
    fetchPendingDrafts(userId),
  ]);

  const aCards: QueueCardA[] = proposalRows.map(proposalToTypeA);
  const { bCards, cCards, eCards } = partitionDrafts(draftRows);

  // Spec sort: A → B → C → D → E, newest-first within each group.
  // (D cards fold into Recent activity; the queue surfaces no D cards.)
  return [
    ...sortByCreatedDesc(aCards),
    ...sortByCreatedDesc(bCards),
    ...sortByCreatedDesc(cCards),
    ...sortByCreatedDesc(eCards),
  ].slice(0, QUEUE_FETCH_LIMIT);
}

// ── Proposal → Type A ────────────────────────────────────────────────

async function fetchPendingProposals(userId: string): Promise<AgentProposalRow[]> {
  // The auto_action_log issueType is purely passive — it logs that
  // Steadii silently did X. Those folks belong in Recent activity, not
  // the queue (per spec: D collapses into Recent activity).
  // admin_waitlist_pending is a different sidebar surface (admin role).
  let rows: AgentProposalRow[];
  try {
    rows = await db
      .select()
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          eq(agentProposals.status, "pending"),
          ne(agentProposals.issueType, "auto_action_log"),
          ne(agentProposals.issueType, "admin_waitlist_pending")
        )
      )
      .orderBy(desc(agentProposals.createdAt))
      .limit(QUEUE_FETCH_LIMIT);
  } catch {
    // Schema-drift defense — if agent_proposals is missing (older deploys
    // / test envs) we'd rather degrade to empty than crash Home.
    return [];
  }

  // Dedup at the queue layer. The Phase 8 proactive scanner can fire
  // multiple times against the same conflict before the user resolves
  // it (cron re-runs / race on same calendar pair / variant code paths)
  // and the surface ends up showing 2-3 cards with identical body text.
  // Rule-based dedup at insert is the long-term fix; for now we collapse
  // here on (issueType, sourceRefs-as-JSON), keeping the most recent.
  // Rows already arrive sorted by createdAt DESC so the first occurrence
  // per key is the newest — safe to filter on first-seen.
  const seen = new Set<string>();
  const deduped: AgentProposalRow[] = [];
  for (const row of rows) {
    const key = `${row.issueType}:${JSON.stringify(row.sourceRefs ?? [])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function proposalToTypeA(p: AgentProposalRow): QueueCardA {
  const options = (p.actionOptions ?? []).map(actionOptionToQueue);
  return {
    id: `proposal:${p.id}`,
    archetype: "A",
    title: titleForIssue(p.issueType, p.issueSummary),
    body: p.issueSummary,
    confidence: confidenceForIssue(p.issueType),
    createdAt: p.createdAt.toISOString(),
    sources: sourceChipsFromRefs(p.sourceRefs ?? []),
    detailHref: `/app/inbox/proposals/${p.id}`,
    originHref: undefined,
    reversible: isReversibleProposal(p.issueType),
    options,
    issueType: p.issueType,
  };
}

function actionOptionToQueue(opt: ActionOption): QueueDecisionOption {
  return {
    key: opt.key,
    label: opt.label,
    description: opt.description,
    // The Phase 8 action options carry no "recommended" flag today; we
    // surface the first option as the default visual primary unless the
    // tool is `dismiss` (which is never the primary).
    recommended: opt.tool !== "dismiss",
  };
}

// Map issue types to a one-line title that reads as the *headline* of
// the card. The proposal's `issueSummary` flows into the body so the
// title can be terse.
function titleForIssue(
  issue: AgentProposalIssueType,
  fallback: string
): string {
  switch (issue) {
    case "time_conflict":
      return "Calendar conflict";
    case "exam_conflict":
      return "Exam clash";
    case "deadline_during_travel":
      return "Deadline during travel";
    case "exam_under_prepared":
      return "Exam prep gap";
    case "workload_over_capacity":
      return "Workload overload";
    case "syllabus_calendar_ambiguity":
      return "Syllabus needs review";
    default:
      return fallback || "Steadii noticed";
  }
}

// Confidence buckets per issue type. The current proposal generator
// doesn't ship a numeric confidence score, so we encode the best-known
// signal: hard structural conflicts → high; capacity / heuristic-based
// rules → medium; ambiguity flags → low (the spec literally calls these
// "詳細確認推奨" / "verify before acting").
function confidenceForIssue(
  issue: AgentProposalIssueType
): QueueConfidence {
  switch (issue) {
    case "time_conflict":
    case "exam_conflict":
    case "deadline_during_travel":
      return "high";
    case "exam_under_prepared":
    case "workload_over_capacity":
      return "medium";
    case "syllabus_calendar_ambiguity":
      return "low";
    default:
      return "medium";
  }
}

function isReversibleProposal(issue: AgentProposalIssueType): boolean {
  // Reversible = the action the user picks can be undone within 10s.
  // Calendar moves and event deletes are reversible (we can re-create);
  // emails are reversible during the 10s undo window only and we model
  // that on the B card. Proposals don't currently produce email-send
  // options as primary, so default to reversible.
  switch (issue) {
    case "syllabus_calendar_ambiguity":
      // Linking a calendar event to a syllabus row is reversible.
      return true;
    case "time_conflict":
    case "exam_conflict":
    case "deadline_during_travel":
      // Reschedule / cancel options are reversible.
      return true;
    case "exam_under_prepared":
    case "workload_over_capacity":
      // No external state is changed — these create study tasks /
      // mistake notes. Trivially reversible.
      return true;
    default:
      return true;
  }
}

// ── Drafts → Type B / C / E ──────────────────────────────────────────

type DraftWithInbox = {
  draft: AgentDraft;
  inbox: {
    id: string;
    senderName: string | null;
    senderEmail: string;
    subject: string | null;
  };
};

async function fetchPendingDrafts(userId: string): Promise<DraftWithInbox[]> {
  const rows = await db
    .select({
      draft: agentDrafts,
      inboxId: inboxItems.id,
      senderName: inboxItems.senderName,
      senderEmail: inboxItems.senderEmail,
      subject: inboxItems.subject,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, [
          "draft_reply",
          "ask_clarifying",
          "notify_only",
        ]),
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(QUEUE_FETCH_LIMIT);

  return rows.map((r) => ({
    draft: r.draft,
    inbox: {
      id: r.inboxId,
      senderName: r.senderName,
      senderEmail: r.senderEmail,
      subject: r.subject,
    },
  }));
}

function partitionDrafts(rows: DraftWithInbox[]): {
  bCards: QueueCardB[];
  cCards: QueueCardC[];
  eCards: QueueCardE[];
} {
  const bCards: QueueCardB[] = [];
  const cCards: QueueCardC[] = [];
  const eCards: QueueCardE[] = [];
  for (const row of rows) {
    const action = row.draft.action;
    if (action === "draft_reply") bCards.push(draftToTypeB(row));
    else if (action === "ask_clarifying") eCards.push(draftToTypeE(row));
    else if (action === "notify_only") cCards.push(draftToTypeC(row));
  }
  return { bCards, cCards, eCards };
}

function draftToTypeB(row: DraftWithInbox): QueueCardB {
  const { draft, inbox } = row;
  const senderLabel = inbox.senderName ?? inbox.senderEmail;
  return {
    id: `draft:${draft.id}`,
    archetype: "B",
    title: senderLabel,
    body: inbox.subject ? `re: ${inbox.subject}` : "",
    confidence: confidenceForRiskTier(draft.riskTier),
    createdAt: draft.createdAt.toISOString(),
    sources: sourceChipsFromProvenance(draft.retrievalProvenance ?? null),
    detailHref: `/app/inbox/${draft.id}`,
    originHref: `/app/inbox/${draft.id}`,
    originLabel: "Open thread",
    reversible: true,
    draftPreview: truncatePreview(draft.draftBody ?? ""),
    subjectLine: draft.draftSubject ?? inbox.subject ?? undefined,
    toLabel:
      draft.draftTo && draft.draftTo.length > 0
        ? `To: ${draft.draftTo.join(", ")}`
        : undefined,
  };
}

function draftToTypeC(row: DraftWithInbox): QueueCardC {
  const { draft, inbox } = row;
  const senderLabel = inbox.senderName ?? inbox.senderEmail;
  return {
    id: `draft:${draft.id}`,
    archetype: "C",
    title: inbox.subject ?? senderLabel,
    body: `Important from ${senderLabel}. No reply expected — review when you can.`,
    confidence: confidenceForRiskTier(draft.riskTier),
    createdAt: draft.createdAt.toISOString(),
    sources: sourceChipsFromProvenance(draft.retrievalProvenance ?? null),
    detailHref: `/app/inbox/${draft.id}`,
    originHref: `/app/inbox/${draft.id}`,
    originLabel: "Open",
    reversible: false,
    primaryActionLabel: "Take action",
  };
}

function draftToTypeE(row: DraftWithInbox): QueueCardE {
  const { draft, inbox } = row;
  const senderLabel = inbox.senderName ?? inbox.senderEmail;
  return {
    id: `draft:${draft.id}`,
    archetype: "E",
    title: inbox.subject ?? senderLabel,
    body:
      draft.reasoning ??
      `Steadii needs more context before drafting a reply to ${senderLabel}.`,
    confidence: confidenceForRiskTier(draft.riskTier),
    createdAt: draft.createdAt.toISOString(),
    sources: sourceChipsFromProvenance(draft.retrievalProvenance ?? null),
    detailHref: `/app/inbox/${draft.id}`,
    originHref: `/app/inbox/${draft.id}`,
    originLabel: "Open thread",
    reversible: false,
    // Wave 2 ships a single free-text fallback. Per-draft radio choices
    // would require a structured "questions" payload from the L2 deep
    // pass that doesn't exist yet — flag for Wave 3.
    choices: [],
  };
}

// risk_tier → confidence visual. high-risk → low confidence (more
// scrutiny needed); medium-risk → medium; low-risk drafts → high
// confidence (we're sure this is mundane).
function confidenceForRiskTier(
  tier: AgentDraft["riskTier"]
): QueueConfidence {
  switch (tier) {
    case "high":
      return "low";
    case "medium":
      return "medium";
    case "low":
      return "high";
  }
}

function truncatePreview(body: string, max = 320): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

// ── Source citations ─────────────────────────────────────────────────

function sourceChipsFromRefs(refs: ProposalSourceRef[]): QueueSourceChip[] {
  const result: QueueSourceChip[] = [];
  let emailIdx = 0;
  let mistakeIdx = 0;
  let syllabusIdx = 0;
  let calendarIdx = 0;
  for (const ref of refs) {
    switch (ref.kind) {
      case "calendar_event":
      case "syllabus_event":
      case "assignment":
        calendarIdx += 1;
        result.push({
          kind: "calendar",
          index: calendarIdx,
          label: ref.label,
        });
        break;
      case "syllabus":
        syllabusIdx += 1;
        result.push({
          kind: "syllabus",
          index: syllabusIdx,
          label: ref.label,
        });
        break;
      case "mistake":
        mistakeIdx += 1;
        result.push({ kind: "mistake", index: mistakeIdx, label: ref.label });
        break;
      case "inbox_item":
        emailIdx += 1;
        result.push({ kind: "email", index: emailIdx, label: ref.label });
        break;
      // class / waitlist_request — no chip visual today
      default:
        break;
    }
  }
  return result;
}

function sourceChipsFromProvenance(
  prov: RetrievalProvenance | null
): QueueSourceChip[] {
  if (!prov) return [];
  const chips: QueueSourceChip[] = [];
  let emailIdx = 0;
  let mistakeIdx = 0;
  let syllabusIdx = 0;
  let calendarIdx = 0;
  for (const s of prov.sources ?? []) {
    switch (s.type) {
      case "email":
        emailIdx += 1;
        chips.push({
          kind: "email",
          index: emailIdx,
          label: s.snippet?.slice(0, 80) ?? "email",
        });
        break;
      case "mistake":
        mistakeIdx += 1;
        chips.push({
          kind: "mistake",
          index: mistakeIdx,
          label: s.snippet?.slice(0, 80) ?? "mistake",
        });
        break;
      case "syllabus":
        syllabusIdx += 1;
        chips.push({
          kind: "syllabus",
          index: syllabusIdx,
          label: s.snippet?.slice(0, 80) ?? "syllabus",
        });
        break;
      case "calendar":
        calendarIdx += 1;
        chips.push({ kind: "calendar", index: calendarIdx, label: s.title });
        break;
    }
  }
  return chips;
}

// ── Sorting ──────────────────────────────────────────────────────────

function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Re-exports / accessors used by Recent Activity (Scope 5) ─────────

export async function fetchAutoActionLogs(
  userId: string,
  limit = 10
): Promise<AgentProposalRow[]> {
  try {
    return await db
      .select()
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.userId, userId),
          or(
            eq(agentProposals.issueType, "auto_action_log"),
            eq(agentProposals.status, "resolved"),
            eq(agentProposals.status, "dismissed")
          )
        )
      )
      .orderBy(desc(agentProposals.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}
