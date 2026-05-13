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

  // SUBJECT_LINE_FABRICATED_ON_REPLY (engineer-53). A `件名:` / `Subject:`
  // line at the start of a draft body is wrong for reply context — email
  // clients auto-prefix `Re:` on the parent subject, so a fabricated
  // subject inside the body is dead weight at best and misleading at
  // worst (the agent's invented subject often diverges from the real
  // thread's subject). Conservative match: only fires when the line is
  // at line-start AND followed by `Re:` / `RE:` / `re:` — that pattern
  // is unambiguously a reply-context fabrication. Plain `Subject:` with
  // no `Re:` may be a new-mail draft (out of scope) so we skip those.
  {
    name: "件名 fabricated on reply",
    pattern: /^\s*(件名|Subject)\s*[:：]\s*Re:/im,
  },

  // ACTION_COMMITMENT_VIOLATION trailing variant (engineer-53).
  // Narration of a future fetch/check action that should have happened
  // BEFORE the draft. When this phrase reaches the user it means the
  // agent shipped output AND admitted on-the-record it didn't fetch.
  // The orchestrator's main loop is supposed to invoke any such tool
  // in the SAME turn the agent commits to it; reaching the user with
  // this phrase is a documented failure shape.
  //
  // Detector catches both the masu-form ("〜確認します") and the te-form
  // chain ("〜確認して、〜拾います") because the actual 2026-05-13 dogfood
  // failure used the te-form. Past-tense ("〜確認しました") is excluded
  // by being absent from the alternation — we want fire only on
  // future-intent phrases. Common JA/EN forms only; doesn't try to be
  // exhaustive — false negatives are tolerable since the prompt's
  // MUST-rule 8 catches the rest.
  {
    name: "trailing future action",
    pattern:
      /(メール本文を確認します|メール本文を確認して|本文を確認します|本文を確認して|確認して報告します|チェックして送ります|reviewing the email|let me check the body|let me read the body|i'll check the email body)/i,
  },

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
  // Per-mode corrective hints — appended when the matched tokens
  // signal a specific failure shape beyond the generic placeholder
  // case. Keeps the message focused: the agent gets actionable guidance
  // tied to the actual leak, not a wall of every-possible-mistake text.
  const extras: string[] = [];
  if (matched.includes("件名 fabricated on reply")) {
    extras.push(
      "- SUBJECT_LINE_FABRICATED_ON_REPLY: you emitted a `件名: Re:` / `Subject: Re:` line inside the draft body. Email clients auto-prefix `Re:` on a reply — the body should be reply prose ONLY, no subject header inside. Remove the subject line entirely; do not 'fix' it by rewording."
    );
  }
  if (matched.includes("trailing future action")) {
    extras.push(
      "- ACTION_COMMITMENT_VIOLATION (trailing): you trailed a phrase like `メール本文を確認します` AFTER your draft was already emitted. That sequence ships ungrounded output AND admits on-the-record that you should have fetched. The fix is to actually fetch (email_get_body, etc.) BEFORE re-emitting the draft — never as a postscript. Drop the trailing 'will check' phrase from the rewrite."
    );
  }
  return [
    "PLACEHOLDER_LEAK detected in your previous response.",
    "",
    `Matched forbidden tokens: ${matched.join(", ")}.`,
    "",
    "Your previous output contained placeholder slots — meaning you produced a template instead of grounded text. The OUTPUT GROUNDING rule in your system prompt is non-negotiable: every specific claim must be backed by a tool-call result or a user-fact, NOT by a generic template.",
    ...(extras.length > 0 ? ["", "Mode-specific notes:", ...extras] : []),
    "",
    "Re-do this turn:",
    "1. Identify which specific values are missing (a name, a date, a slot, a course code, etc.).",
    "2. Call the appropriate tool to fetch each — email_get_body for email content, lookup_entity → followed by content fetch for cross-source context, calendar_list_events for schedules, infer_sender_timezone + convert_timezone for time slots, etc.",
    "3. Re-write the response with the fetched values inlined. Do NOT emit any of the forbidden tokens above.",
    "",
    "If a value truly cannot be fetched (tool fails, no record), state that PLAINLY in the response — do NOT substitute a placeholder.",
  ].join("\n");
}
