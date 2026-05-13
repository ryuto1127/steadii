// Shared types for the proactive scanner. Imported by snapshot.ts, the
// individual rule modules, and the proposal generator.

import type {
  ActionOption,
  AgentProposalIssueType,
  ProposalSourceRef,
} from "@/lib/db/schema";

// Read-only view of the user's relevant state at scan time. Snapshots are
// computed once per scan and reused by every rule so each scan is a single
// query burst rather than N queries per rule.
export type UserSnapshot = {
  userId: string;
  now: Date;
  timezone: string | null;

  classes: Array<{
    id: string;
    name: string;
    code: string | null;
    professor: string | null;
    status: string;
  }>;

  // Calendar events upcoming in the rolling [now, now + 90d] window. The
  // rules need both single-instance events and multi-day spans, so we
  // include `startsAt`, `endsAt`, and `isAllDay`.
  calendarEvents: Array<{
    id: string;
    sourceType: string;
    externalId: string;
    title: string;
    description: string | null;
    startsAt: Date;
    endsAt: Date | null;
    isAllDay: boolean;
    location: string | null;
    // engineer-43 — used by classroom_deadline_imminent to skip
    // already-turned-in coursework. Optional because non-Classroom events
    // don't carry a meaningful status today.
    status: string | null;
  }>;

  assignments: Array<{
    id: string;
    classId: string | null;
    title: string;
    dueAt: Date | null;
    status: string;
    estimatedHours?: number;
  }>;

  // Syllabi schedule items + extracted exam dates. Rules consume the
  // structured `schedule[]` plus a derived `exams[]` (computed in
  // snapshot.ts from schedule rows whose `topic` mentions exam keywords).
  syllabi: Array<{
    id: string;
    classId: string | null;
    title: string;
    schedule: Array<{ date: string | null; topic: string | null }>;
  }>;

  // Lecture-block windows extracted from syllabus.schedule (when a row's
  // date falls inside the snapshot horizon). Rule 1 (time_conflict) uses
  // these as the canonical class-time source since the dedicated lecture
  // recurrence isn't stored separately.
  classTimeBlocks: Array<{
    classId: string;
    classCode: string | null;
    className: string;
    startsAt: Date;
    endsAt: Date;
    topic: string | null;
  }>;

  // Exam windows derived from syllabi where `topic` matches exam regex.
  examWindows: Array<{
    classId: string | null;
    classCode: string | null;
    className: string | null;
    startsAt: Date;
    endsAt: Date;
    label: string;
  }>;

  // Prior recent activity per class, keyed by classId. Used by Rule 4.
  recentClassActivityDays: Record<string, number | null>;

  // engineer-49 — monthly boundary-review summary. Used by the
  // monthly_boundary_review rule. Null when the user has no
  // sender_confidence rows at all (no signal to surface).
  monthlyReview: null | {
    lastReviewAt: Date | null;
    approvedThisMonth: number;
    dismissedThisMonth: number;
    rejectedThisMonth: number;
    autoSendCount: number;
    alwaysReviewCount: number;
  };

  // engineer-51 — entity-graph signals consumed by the entity_fading +
  // entity_deadline_cluster rules. Built lazily inside snapshot.ts so a
  // missing entities table (pre-migration) doesn't crash the build.
  entitySignals: Array<{
    entityId: string;
    kind: string;
    displayName: string;
    // Days since the most recent link to this entity.
    daysSinceLastLink: number;
    // Mean gap (in days) between consecutive links, computed from the
    // last 30 links. Used as the "normal cadence" for the fading
    // detector. Null when fewer than 4 links — not enough signal.
    meanGapDays: number | null;
    // Stddev of consecutive link gaps. Same source as meanGapDays.
    stddevGapDays: number | null;
    // Count of assignments / events tied to this entity in the next
    // 7-day forward window. Drives the deadline-cluster rule.
    upcomingItemCount: number;
    upcomingItemRefs: Array<{
      kind: "assignment" | "calendar_event";
      id: string;
      title: string;
      occursAt: Date;
    }>;
  }>;
};

// What a rule emits before the proposal generator turns it into a final
// `agent_proposals` row. The scanner adds the `dedupKey`, `triggerEventId`,
// and the LLM-generated `actionOptions[]`.
export type DetectedIssue = {
  issueType: AgentProposalIssueType;
  // Stable identifier components for dedup. The scanner sorts and hashes
  // these alongside `issueType`.
  sourceRecordIds: string[];
  // 1-line summary (no LLM yet — the rule writes this directly).
  issueSummary: string;
  // Glass-box reasoning: WHY the rule fired. Concrete dates / titles.
  reasoning: string;
  // Pointers back to the originating records.
  sourceRefs: ProposalSourceRef[];
  // Optional rule-suggested baseline action options. The proposal
  // generator can extend / replace them via the LLM.
  baselineActions?: ActionOption[];
};

export type ProactiveRule = {
  name: string;
  detect: (snapshot: UserSnapshot) => DetectedIssue[];
};
