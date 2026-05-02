import "server-only";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  agentProposals,
  groupProjects,
  type ActionOption,
  type NewAgentProposalRow,
  type ProposalSourceRef,
} from "@/lib/db/schema";
import { createGroupProject, detectGroupCandidates } from "./detect";
import type { GroupCandidate } from "./types";

// Persists detected group candidates as `agent_proposals` rows so they
// flow through the existing queue / dismiss / dedup machinery. The
// queue builder maps `group_project_detected` → Type E and
// `group_member_silent` → Type C. Already-tracked candidates are
// skipped at detection time.
export async function persistGroupDetectionCandidates(
  userId: string
): Promise<{ created: number; skipped: number }> {
  const candidates = await detectGroupCandidates(userId);
  let created = 0;
  let skipped = 0;
  for (const c of candidates) {
    const result = await persistOne(userId, c);
    if (result === "created") created += 1;
    else skipped += 1;
  }
  return { created, skipped };
}

async function persistOne(
  userId: string,
  c: GroupCandidate
): Promise<"created" | "skipped"> {
  const dedupKey = `group_detect:${c.detectionKey}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sourceRefs: ProposalSourceRef[] = c.signals
    .map((s): ProposalSourceRef | null => {
      if (s.kind === "email_thread") {
        return {
          kind: "inbox_item",
          id: s.threadId,
          label: `${s.messageCount} messages · ${s.participants.length} people`,
        };
      }
      if (s.kind === "calendar_event") {
        return {
          kind: "calendar_event",
          id: s.eventId,
          label: s.title,
        };
      }
      // syllabus_chunk — surface as a syllabus chip without a deep link
      return {
        kind: "syllabus",
        id: s.syllabusId,
        label: s.snippet.slice(0, 80),
      };
    })
    .filter((r): r is ProposalSourceRef => r !== null);

  const actionOptions: ActionOption[] = [
    {
      key: "create",
      label: "Create tracker",
      description: "Steadii will track members, deadlines, and silence.",
      tool: "auto",
      payload: {
        candidate: serializableCandidate(c),
      },
    },
    {
      key: "not_group",
      label: "Not a group project",
      description: "Don't track this thread.",
      tool: "dismiss",
      payload: {},
    },
  ];

  const summary = c.classCode
    ? `${c.classCode} group activity detected: ${c.memberEmails.length} people, ${c.signals.length} signal(s).`
    : `Group activity detected: ${c.memberEmails.length} people, ${c.signals.length} signal(s).`;

  const row: NewAgentProposalRow = {
    userId,
    issueType: "group_project_detected",
    issueSummary: summary,
    reasoning: c.suggestedTitle,
    sourceRefs,
    actionOptions,
    dedupKey,
    expiresAt,
  };
  const inserted = await db
    .insert(agentProposals)
    .values(row)
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    })
    .returning({ id: agentProposals.id });
  return inserted.length > 0 ? "created" : "skipped";
}

function serializableCandidate(c: GroupCandidate): Record<string, unknown> {
  return {
    classId: c.classId,
    title: c.suggestedTitle,
    memberEmails: c.memberEmails,
    sourceThreadIds: c.signals
      .filter((s) => s.kind === "email_thread")
      .map((s) => (s as { threadId: string }).threadId),
  };
}

// Resolution path — called from queue-actions when the user picks an
// option on a Type E group_project_detected card.
export async function resolveGroupDetectClarification(
  userId: string,
  proposalId: string,
  args: {
    pickedKey: string | null;
    freeText: string;
    decision: "create" | "not_group" | "later";
  }
): Promise<{ groupProjectId?: string }> {
  const [proposal] = await db
    .select()
    .from(agentProposals)
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    )
    .limit(1);
  if (!proposal) return {};
  if (proposal.issueType !== "group_project_detected") return {};

  // Map the queue's pickedKey → decision. The Type E renderer uses radio
  // choices that can override the dismiss decision passed in by the
  // caller (queue-actions defaults to "later" for the dismiss button).
  const effectiveDecision: "create" | "not_group" | "later" =
    args.pickedKey === "create"
      ? "create"
      : args.pickedKey === "not_group"
        ? "not_group"
        : args.decision;

  if (effectiveDecision === "create") {
    const option = (proposal.actionOptions as ActionOption[]).find(
      (o) => o.key === "create"
    );
    const payload = (option?.payload ?? {}) as {
      candidate?: {
        classId: string | null;
        title: string;
        memberEmails: string[];
        sourceThreadIds: string[];
      };
    };
    const cand = payload.candidate;
    if (!cand) return {};

    const created = await createGroupProject({
      userId,
      classId: cand.classId,
      title: cand.title,
      detectionMethod: "auto",
      sourceThreadIds: cand.sourceThreadIds,
      memberEmails: cand.memberEmails,
    });

    await db
      .update(agentProposals)
      .set({
        status: "resolved",
        resolvedAction: "create",
        resolvedAt: new Date(),
        viewedAt: proposal.viewedAt ?? new Date(),
      })
      .where(eq(agentProposals.id, proposalId));
    return { groupProjectId: created.id };
  }

  // not_group → dismissed permanently; later → soft snooze 24h
  await db
    .update(agentProposals)
    .set({
      status: effectiveDecision === "not_group" ? "dismissed" : "dismissed",
      resolvedAction: effectiveDecision,
      resolvedAt: new Date(),
      viewedAt: proposal.viewedAt ?? new Date(),
      expiresAt:
        effectiveDecision === "later"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })
    .where(eq(agentProposals.id, proposalId));
  return {};
}

// Used by the daily silence cron — for each group with newly-silent
// members, insert (or refresh) a Type C proposal pointing to the group
// detail page.
export async function persistSilenceProposals(
  userId: string,
  silentByGroup: Array<{ groupProjectId: string; memberEmail: string; memberName: string | null; daysSilent: number; groupTitle: string }>
): Promise<{ created: number }> {
  let created = 0;
  for (const s of silentByGroup) {
    const dedupKey = `group_silent:${s.groupProjectId}:${s.memberEmail}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const memberLabel = s.memberName ?? s.memberEmail;
    const summary = `${s.groupTitle} · ${memberLabel} silent ${s.daysSilent} days`;
    const row: NewAgentProposalRow = {
      userId,
      issueType: "group_member_silent",
      issueSummary: summary,
      reasoning: `No reply from ${memberLabel} for ${s.daysSilent} days.`,
      sourceRefs: [],
      actionOptions: [
        {
          key: "draft_checkin",
          label: "Draft check-in",
          description: "Open the group page to draft a low-stakes check-in.",
          tool: "auto",
          payload: { groupProjectId: s.groupProjectId },
        },
      ],
      dedupKey,
      expiresAt,
    };
    const inserted = await db
      .insert(agentProposals)
      .values(row)
      .onConflictDoNothing({
        target: [agentProposals.userId, agentProposals.dedupKey],
      })
      .returning({ id: agentProposals.id });
    if (inserted.length > 0) created += 1;
  }
  return { created };
}
