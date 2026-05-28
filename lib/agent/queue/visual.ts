// Pure visual helpers for the queue card. Extracted so they can be unit
// tested without JSX rendering (the test environment is node-only;
// see `vitest.config.ts`).

import type { QueueArchetype, QueueCardG, QueueConfidence } from "./types";

// Round 4 (2026-05-24) — Type H header copy + expiry hints. The card
// surfaces a batch confirmation for propose-archive items; helpers
// here pin the i18n keys + the soonest-expiry threshold so the
// renderer stays declarative.

// Confidence → left-border tailwind class. Mirrors the spec table at
// `project_wave_2_home_design.md` § "Confidence indicator":
//   - high   → vivid 4px primary border
//   - medium → 2px low-opacity primary border
//   - low    → no border (and the card body adds an italic note;
//              that part lives in the component since it's a render
//              concern, not a class concern)
export function confidenceBorderClass(tier: QueueConfidence): string {
  switch (tier) {
    case "high":
      return "border-l-[4px] border-l-[hsl(var(--primary))]";
    case "medium":
      return "border-l-2 border-l-[hsl(var(--primary)/0.35)]";
    case "low":
      return "border-l-0";
  }
}

// Archetype → CSS variant identifier the shell uses to pick chrome
// (decision-required cards get a tinted border; FYI cards get a subtle
// muted variant). Type F (confirmations) borrows the decision variant —
// the user has to answer before downstream drafts will use the right
// inferred value.
export function archetypeShellVariant(
  archetype: QueueArchetype
): "default" | "decision" | "fyi" {
  switch (archetype) {
    case "A":
    case "F":
      return "decision";
    case "D":
      return "fyi";
    default:
      return "default";
  }
}

// True when the card's originHref points at a different origin (Gmail
// web, Google Calendar, etc.) rather than an internal /app/* route.
// Drives `target="_blank" rel="noopener noreferrer"` on the CardFooter
// anchor so external context jumps don't unmount the user's queue.
// Detected by `http(s)://` prefix — the queue builders use absolute
// URLs only for external destinations.
export function isExternalOriginHref(
  originHref: string | null | undefined
): boolean {
  if (!originHref) return false;
  return originHref.startsWith("http://") || originHref.startsWith("https://");
}

// Pretty-name for an archetype (one-letter pill on the card head).
export function archetypePillKey(archetype: QueueArchetype): string {
  switch (archetype) {
    case "A":
      return "archetype_a_pill";
    case "B":
      return "archetype_b_pill";
    case "C":
      return "archetype_c_pill";
    case "D":
      return "archetype_d_pill";
    case "E":
      return "archetype_e_pill";
    case "F":
      return "archetype_f_pill";
    case "G":
      return "archetype_g_pill";
    case "H":
      return "archetype_h_pill";
  }
}

// ── Type H (propose-archive batch) helpers ───────────────────────────
//
// The renderer dispatches on these so the card stays declarative.
// `cardHShouldShowExpiry` mirrors the Type G' threshold (≤ 1 day to
// expiry triggers the "expires soon" pill); Type H's grace window is
// longer than Type G's (proposals are auto-cleared after 7d here)
// but we keep the visual trigger conservative — surfacing the pill
// only when the soonest item is within 1 day matches the spec's
// "optional: expires-in-Nd indicator if any item is within 1d of
// its 7d sweep deadline".

// Days until the soonest item in the batch expires (clamped to >= 0).
// Returns null when the input is malformed so the caller can skip
// rendering.
export function cardHDaysUntilExpiry(
  proposedAtIso: string,
  nowMs: number = Date.now(),
  staleAfterMs: number = 7 * 24 * 60 * 60 * 1000,
): number | null {
  const proposedMs = Date.parse(proposedAtIso);
  if (!Number.isFinite(proposedMs)) return null;
  const expiresMs = proposedMs + staleAfterMs;
  const diffMs = expiresMs - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

// Spec: surface the "expires soon" pill only when the soonest item is
// within 1 day of its 7-day sweep deadline. Earlier than that the
// card would just clutter.
export function cardHShouldShowExpiry(daysUntilExpiry: number | null): boolean {
  if (daysUntilExpiry === null) return false;
  return daysUntilExpiry <= 1;
}

// ── Type G' (auto-cal propose-confirm) helpers ───────────────────────
//
// Pulled out of the card so PR B's behavioral surface is testable
// without rendering JSX (vitest is node-only here). The card calls
// these for: header copy keyed by the proposal kind, edit-time
// validation rules (end > start, past-date warning), and the
// "expires in N days" countdown that only renders close to the
// 7-day grace expiry so the card doesn't clutter early.

export type EditorSlotShape = {
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM 24h
  durationMin?: number; // minutes; 0 = all-day
};

// i18n key for the proposal header — split on `kind` so deadline
// proposals say "this deadline" rather than "this event". The 'event'
// kind reuses the mutual header ("Steadii proposes this event" /
// 「この予定を提案しています」), which is already kind-agnostic for a
// timed scheduled event.
export function cardGProposalHeaderKey(
  kind: QueueCardG["kind"],
): "proposal_header_deadline" | "proposal_header_mutual" {
  return kind === "deadline" ? "proposal_header_deadline" : "proposal_header_mutual";
}

// True when the card's `kind` warrants showing time pickers in the
// inline editor. Deadline proposals are all-day and only need date +
// title (no start time, no duration). mutual_agreement AND event are
// both TIMED, so they show the start-time + duration pickers.
export function cardGShouldShowTimePickers(kind: QueueCardG["kind"]): boolean {
  return kind === "mutual_agreement" || kind === "event";
}

// Days remaining until grace expiry, clamped to >= 0. Returns null
// when the input is malformed so the caller can skip rendering.
export function cardGDaysUntilExpiry(
  graceExpiresIso: string,
  nowMs: number = Date.now(),
): number | null {
  const expiresMs = Date.parse(graceExpiresIso);
  if (!Number.isFinite(expiresMs)) return null;
  const diffMs = expiresMs - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

// Only surface the "expires in N days" countdown when the proposal is
// close to auto-dismiss. Per spec: render iff days <= 3.
export function cardGShouldShowExpiry(daysUntilExpiry: number | null): boolean {
  if (daysUntilExpiry === null) return false;
  return daysUntilExpiry <= 3;
}

// Editor validation. Returns the i18n key of the violation, or null
// when the proposed slot is acceptable. We surface "past date" as a
// warning rather than a hard block per spec; the caller decides how
// to render the difference (toast vs inline) but the validator just
// emits the key.
export type CardGValidationResult =
  | { ok: true }
  | { ok: false; error: "validation_end_before_start" }
  | { ok: true; warning: "validation_past_date_warning" };

// Compute the minimal edit patch the editor should send to
// autoCalProposalEditAction. Untouched fields are omitted so the
// server-side merge only overwrites what changed. Lifted out of the
// editor so the chain `[更新して追加]` → editProposal → addToCalendar
// is independently testable; the editor calls this then forwards
// the result.
export function cardGBuildEditPatch(args: {
  kind: QueueCardG["kind"];
  initial: {
    date: string;
    startTime: string | null;
    durationMin: number;
    title: string;
  };
  next: {
    date: string;
    startTime: string;
    durationMin: number;
    title: string;
  };
}): {
  date?: string;
  startTime?: string;
  durationMin?: number;
  title?: string;
} {
  const showTimePickers = cardGShouldShowTimePickers(args.kind);
  const patch: {
    date?: string;
    startTime?: string;
    durationMin?: number;
    title?: string;
  } = {};
  if (args.next.date && args.next.date !== args.initial.date) {
    patch.date = args.next.date;
  }
  if (showTimePickers) {
    if (
      args.next.startTime &&
      args.next.startTime !== args.initial.startTime
    ) {
      patch.startTime = args.next.startTime;
    }
    if (args.next.durationMin !== args.initial.durationMin) {
      patch.durationMin = args.next.durationMin;
    }
  }
  if (args.next.title && args.next.title !== args.initial.title) {
    patch.title = args.next.title;
  }
  return patch;
}

export function cardGValidateEdit(args: {
  kind: QueueCardG["kind"];
  date: string | undefined;
  startTime: string | undefined;
  durationMin: number | undefined;
  nowMs?: number;
}): CardGValidationResult {
  const isTimed = cardGShouldShowTimePickers(args.kind);
  // End > start: only enforceable when both startTime + durationMin are
  // present AND the proposal is timed. A 0-duration timed event = end
  // equals start, which we reject as well (matches "must be after").
  if (isTimed && args.startTime && typeof args.durationMin === "number") {
    if (args.durationMin <= 0) {
      return { ok: false, error: "validation_end_before_start" };
    }
  }
  // Past-date warning: only when a date was supplied. >30 days in the
  // past surfaces the warning; the user is still allowed to submit.
  if (args.date) {
    const nowMs = args.nowMs ?? Date.now();
    const [y, m, d] = args.date.split("-").map((s) => parseInt(s, 10));
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      // Anchor at UTC noon to dodge DST off-by-one.
      const slotMs = Date.UTC(y, m - 1, d, 12, 0, 0);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (nowMs - slotMs > thirtyDaysMs) {
        return { ok: true, warning: "validation_past_date_warning" };
      }
    }
  }
  return { ok: true };
}
