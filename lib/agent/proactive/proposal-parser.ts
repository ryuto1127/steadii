// Pure parsing helpers for the proposal generator. Lives in its own
// file (no server-only / db / openai imports) so the test suite can
// exercise it without a full env.

import type {
  ActionOption,
  AgentProposalActionTool,
  AgentProposalIssueType,
} from "@/lib/db/schema";

// Closed set per D9. Mirror of the array used inside the LLM prompt.
export const PROACTIVE_ALLOWED_TOOLS: AgentProposalActionTool[] = [
  "email_professor",
  "reschedule_event",
  "delete_event",
  "create_task",
  "chat_followup",
  "add_mistake_note",
  "link_existing",
  "add_anyway",
  "dismiss",
];

export function isAllowedProactiveTool(
  s: string
): s is AgentProposalActionTool {
  return (PROACTIVE_ALLOWED_TOOLS as readonly string[]).includes(s);
}

// Parse the JSON output the LLM returns. Returns null on shape errors
// or when fewer than 2 valid options remain — the scanner falls back
// to the rule's baseline menu in that case.
export function parseGeneratorOutput(raw: string): ActionOption[] | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const arr = (j as { actions?: unknown }).actions;
  if (!Array.isArray(arr)) return null;
  const out: ActionOption[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") continue;
    if (typeof o.tool !== "string" || !isAllowedProactiveTool(o.tool)) continue;
    out.push({
      key: o.key,
      label: o.label,
      description: typeof o.description === "string" ? o.description : "",
      tool: o.tool,
      payload:
        o.payload && typeof o.payload === "object"
          ? (o.payload as Record<string, unknown>)
          : {},
    });
  }
  return out.length >= 2 ? out : null;
}

export function ensureDismissOption(actions: ActionOption[]): ActionOption[] {
  if (actions.some((a) => a.tool === "dismiss")) return actions;
  return [
    ...actions,
    {
      key: "dismiss",
      label: "Dismiss",
      description: "Hide this notice for 24 hours.",
      tool: "dismiss",
      payload: {},
    },
  ];
}

// Which issue types go through the LLM. auto_action_log is
// informational-only and skips the generator entirely.
export function shouldGenerateActionsFor(
  issueType: AgentProposalIssueType
): boolean {
  return issueType !== "auto_action_log";
}
