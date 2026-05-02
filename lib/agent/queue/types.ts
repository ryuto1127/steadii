// Shared types for the Wave 2 Steadii queue. The queue is the unified
// surface on `/app` — it merges Phase 8 proposals (`agent_proposals`) and
// W1 drafts (`agent_drafts`) and any future soft-notice feed into one
// archetype-tagged stream.
//
// Five archetypes per `project_wave_2_home_design.md`:
//
//   A — Decision-required (high stakes, blocks until decided)
//   B — Draft-ready (action prepared, awaiting approval)
//   C — Soft notice (no action prepared yet; user click upgrades to B)
//   D — FYI / completed (Steadii already did it; reporting only)
//   E — Clarifying input (Steadii needs missing info)
//
// Sort order is A → B → C → D → E, newest-first within each group. The
// sort comparator lives in `lib/agent/queue/build.ts`.

import type {
  AgentProposalIssueType,
  ActionOption,
  ProposalSourceRef,
} from "@/lib/db/schema";

export type QueueArchetype = "A" | "B" | "C" | "D" | "E";

// 3-tier confidence visual. Numeric % is intentionally NOT shown (see
// memory `project_wave_2_home_design.md` "Confidence indicator"). The
// engineer maps the underlying signal — risk_tier for drafts, ambiguity
// flags for proposals — into one of the three buckets at build time.
export type QueueConfidence = "high" | "medium" | "low";

// Source citation chip — one per source the agent grounded the card on.
// Mirrors the thinking-bar pill kinds (mistake-N / syllabus-N / calendar-N
// / email-N) so users see the same visual vocabulary across surfaces.
export type QueueSourceChip =
  | { kind: "email"; index: number; label: string; href?: string }
  | { kind: "mistake"; index: number; label: string; href?: string }
  | { kind: "syllabus"; index: number; label: string; href?: string }
  | { kind: "calendar"; index: number; label: string; href?: string };

// One option a user can pick on a Type-A decision card. Mirrors the
// `agent_proposals.action_options[]` shape but converted to a UI-friendly
// form so callers don't need to know about the underlying tool/payload.
export type QueueDecisionOption = {
  key: string;
  label: string;
  description?: string;
  // True when this option is the recommended/safest. The card highlights
  // it visually but does not auto-select.
  recommended?: boolean;
};

// Type-E radio choice (clarifying input). The card always renders a
// free-text fallback below the radio list per spec — see the E render
// path in `components/agent/queue-card.tsx`.
export type QueueClarifyChoice = {
  key: string;
  label: string;
};

type QueueCardBase = {
  id: string;
  archetype: QueueArchetype;
  title: string;
  body: string;
  confidence: QueueConfidence;
  // ISO timestamp the underlying record was created at. The card renders
  // a relative timestamp (`5 分前`, `2h ago`) with the absolute time in
  // the title tooltip.
  createdAt: string;
  sources: QueueSourceChip[];
  // Optional href the card navigates to when the body is clicked. We let
  // each archetype pick whether the body opens a detail page or expands
  // inline; for Wave 2 we pick "navigate" for items with their own
  // detail surface (drafts, proposals) and "expand" for synthesized
  // soft notices.
  detailHref?: string;
  // Origin link — jumps to the underlying email / event / syllabus.
  // Optional; cards without an external origin (synthesized notices)
  // omit it.
  originHref?: string;
  originLabel?: string;
  // Whether the agent can fully reverse the action this card applies.
  // Type A/B Send-Email cards are reversible during the 10s undo window
  // only; Type A "delete event" / Type D archive moves are reversible
  // longer. The card uses this to decide whether to show the Undo banner
  // at all.
  reversible: boolean;
};

export type QueueCardA = QueueCardBase & {
  archetype: "A";
  options: QueueDecisionOption[];
  // Issue type drives icon choice on the card head. Optional because not
  // every Type-A originates in a proposal row (future autonomous
  // pre-confirmations are also Type A).
  issueType?: AgentProposalIssueType;
};

export type QueueCardB = QueueCardBase & {
  archetype: "B";
  // 3-4 line preview snippet shown inside the card. The card layout
  // truncates at ~3 lines visually; we don't pre-trim here so the test
  // fixtures can assert full strings.
  draftPreview: string;
  // Subject line — used as a secondary heading in the embedded preview.
  subjectLine?: string;
  // Recipient summary ("To: prof@school.edu") for context. Optional.
  toLabel?: string;
};

export type QueueCardC = QueueCardBase & {
  archetype: "C";
  // The label of the primary action that upgrades the C card into a B
  // card (engine-side draft generation). For Wave 2, clicking dispatches
  // a stub action that records intent — actual draft generation lands in
  // Wave 3 per the handoff doc's "may need new generation logic; can
  // stub for Wave 2".
  primaryActionLabel: string;
};

export type QueueCardD = QueueCardBase & {
  archetype: "D";
  // The completed-action verb shown in the chip ("Archived", "Snoozed",
  // "Auto-replied"). For D cards the card's `body` field carries the
  // detail (e.g. "Archived 12 routine newsletters from <sender>"); the
  // verb is a one-word category for the chip pill.
  actionVerb: string;
  // When the action is reversible AND we're still inside the 24h Undo
  // window per spec, the card shows an Undo button. The wiring of the
  // actual reverse is per-action and out of scope for the card itself.
  undoableUntil?: string;
};

export type QueueCardE = QueueCardBase & {
  archetype: "E";
  choices: QueueClarifyChoice[];
};

export type QueueCard =
  | QueueCardA
  | QueueCardB
  | QueueCardC
  | QueueCardD
  | QueueCardE;

// Re-exported so callers (test fixtures, UI props) can import without
// reaching into schema directly.
export type { ActionOption, ProposalSourceRef };

// Visible-cap and fetch-cap shared between server (build.ts) and client
// (queue-list.tsx). Lives here so the client wrapper doesn't pull in
// the server-only build module.
export const QUEUE_VISIBLE_LIMIT = 7;
export const QUEUE_FETCH_LIMIT = 30;
