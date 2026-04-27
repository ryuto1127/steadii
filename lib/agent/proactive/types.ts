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
