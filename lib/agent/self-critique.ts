// 2026-05-12 (sparring inline post-engineer-51) — output self-critique
// pass for the chat orchestrator. Catches PLACEHOLDER_LEAK failure
// mode (see memory/feedback_agent_failure_modes.md) by running a
// deterministic regex check against the agent's final text. When a
// leak is detected, the orchestrator pushes a corrective system
// message and runs ONE more tool-loop iteration so the agent can
// re-fetch the missing data and emit grounded output.
//
// Regex-only first pass (fast, free, deterministic). LLM-judge
// version could come later if too many leaks slip past — but at α
// scale the explicit forbidden tokens cover the common shapes.
//
// Scope: chat orchestrator only. Agentic L2 has its own forced
// final pass + structured-output JSON schema that already enforces
// non-empty fields.

export type PlaceholderLeakDetection = {
  hasLeak: boolean;
  matched: string[];
};

// Patterns that are NEVER acceptable in a final response. These are
// concrete tokens the agent has no business emitting — they signal
// the agent shipped a template instead of grounded output. Phrases
// like "ご提示いただいた日程" without a date are not in this list
// because regex can't tell whether a date follows.
const FORBIDDEN_TOKENS: Array<{ name: string; pattern: RegExp }> = [
  // Full-width / half-width placeholder bullets common in Japanese
  // letter templates. Single 〇 is sometimes legitimate (used as an
  // adjective ending) so require 2+ in a row.
  { name: "〇〇", pattern: /〇{2,}|○{2,}|◯{2,}/ },

  // Curly-brace placeholder slots: {name}, {date}, {course}, etc.
  // Match {WORD} where WORD is alphanum/JP under 30 chars. Avoid
  // accidentally matching legitimate code in chat ("use the
  // {item.id} property"); single-word identifier-style only.
  {
    name: "{placeholder}",
    pattern:
      /\{[A-Za-z_][A-Za-z0-9_]{0,28}\}|\{[ぁ-んァ-ヶ一-鿿]{1,15}\}/,
  },

  // Square-bracket TBD / ellipsis style.
  { name: "[TBD]/[...]", pattern: /\[(TBD|tbd|未定|\.\.\.|…)\]/ },

  // Time placeholders like xx:xx, XX月XX日, etc.
  { name: "xx:xx", pattern: /\b[xX]{2}:[xX]{2}\b/ },
  { name: "XX月XX日", pattern: /[xX]{2}月[xX]{2}日/ },

  // Numeric placeholders like 00:00 in templates (loose — single 00:00
  // could be a real midnight slot, but in concert with other context...
  // — skip for now, too noisy).
];

export function detectPlaceholderLeak(text: string): PlaceholderLeakDetection {
  const matched: string[] = [];
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.pattern.test(text)) {
      matched.push(tok.name);
    }
  }
  return { hasLeak: matched.length > 0, matched };
}

// Corrective system message the orchestrator pushes onto the
// conversation before doing the one retry iteration. Names the failure
// mode explicitly so the agent's reasoning can correct rather than
// re-emit the same template.
export function buildPlaceholderLeakCorrection(
  matched: string[]
): string {
  return [
    "PLACEHOLDER_LEAK detected in your previous response.",
    "",
    `Matched forbidden tokens: ${matched.join(", ")}.`,
    "",
    "Your previous output contained placeholder slots — meaning you produced a template instead of grounded text. The OUTPUT GROUNDING rule in your system prompt is non-negotiable: every specific claim must be backed by a tool-call result or a user-fact, NOT by a generic template.",
    "",
    "Re-do this turn:",
    "1. Identify which specific values are missing (a name, a date, a slot, a course code, etc.).",
    "2. Call the appropriate tool to fetch each — email_get_body for email content, lookup_entity → followed by content fetch for cross-source context, calendar_list_events for schedules, infer_sender_timezone + convert_timezone for time slots, etc.",
    "3. Re-write the response with the fetched values inlined. Do NOT emit any of the forbidden tokens above.",
    "",
    "If a value truly cannot be fetched (tool fails, no record), state that PLAINLY in the response — do NOT substitute a placeholder.",
  ].join("\n");
}
