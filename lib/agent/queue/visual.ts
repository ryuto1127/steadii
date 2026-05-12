// Pure visual helpers for the queue card. Extracted so they can be unit
// tested without JSX rendering (the test environment is node-only;
// see `vitest.config.ts`).

import type { QueueArchetype, QueueConfidence } from "./types";

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
  }
}
