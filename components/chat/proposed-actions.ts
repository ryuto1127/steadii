// Pure parser for the "Proposed actions:" trailing block emitted by the
// main system prompt. Lives in its own module (no React, no client-only)
// so unit tests can exercise it without a render harness.
//
// Format (per lib/agent/prompts/main.ts §"Format"):
//   ...assistant body...
//   Proposed actions:
//   - [tool_name] short label
//   - [tool_name] another label
//
// Bullet markers accepted: `-`, `*`, `•`. The trailing block stops at the
// first non-bullet, non-empty line — extra trailing whitespace / blank
// lines after the bullets are tolerated.

export type ProposedAction = { toolName: string; label: string };

const HEADER_RE = /^proposed actions:?\s*$/i;
const BULLET_RE = /^[-*•]\s*\[([a-z_][a-z0-9_]*)\]\s*(.+)$/;

export function parseProposedActions(content: string): {
  body: string;
  actions: ProposedAction[];
} {
  if (!content.includes("roposed actions")) {
    return { body: content, actions: [] };
  }

  const lines = content.split("\n");
  // Find the LAST "Proposed actions:" header — robust against the LLM
  // mentioning "proposed actions" inline earlier in the message.
  let blockStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADER_RE.test(lines[i].trim())) {
      blockStart = i;
      break;
    }
  }
  if (blockStart === -1) return { body: content, actions: [] };

  const actions: ProposedAction[] = [];
  for (let i = blockStart + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    const m = BULLET_RE.exec(trimmed);
    if (!m) {
      // Non-bullet content after the header → not a real proposed-actions
      // block; bail out rather than silently swallow content into pills.
      return { body: content, actions: [] };
    }
    actions.push({ toolName: m[1], label: m[2].trim() });
  }

  if (actions.length === 0) {
    // "Proposed actions:" header followed only by blanks — treat as a
    // mid-stream partial. Leave the body intact so the user sees the
    // header until bullets stream in (the parser will run again on the
    // next delta and produce pills once at least one bullet is valid).
    return { body: content, actions: [] };
  }

  const body = lines.slice(0, blockStart).join("\n").trimEnd();
  return { body, actions };
}
