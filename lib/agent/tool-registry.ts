import "server-only";
import { NOTION_TOOLS } from "./tools/notion";
import { CALENDAR_TOOLS } from "./tools/calendar";
import { TASKS_TOOLS } from "./tools/tasks";
import { CLASSROOM_TOOLS } from "./tools/classroom";
import { SYLLABUS_TOOLS } from "./tools/syllabus";
import { SYLLABUS_EXTRACT_TOOLS } from "./tools/syllabus-extract";
import { CLASSES_TOOLS } from "./tools/classes";
import { ASSIGNMENTS_TOOLS } from "./tools/assignments";
import { ICAL_TOOLS } from "./tools/ical";
import { OFFICE_HOURS_TOOLS } from "./tools/office-hours";
import { EMAIL_TOOLS } from "./tools/email";
import { EMAIL_THREAD_TOOLS } from "./tools/email-thread";
import { summarizeWeekTool } from "./tools/summarize-week";
import { CONVERT_TIMEZONE_TOOLS } from "./tools/convert-timezone";
import { RESOLVE_CLARIFICATION_TOOLS } from "./tools/resolve-clarification";
import { SAVE_USER_FACT_TOOLS } from "./tools/save-user-fact";
import { LOOKUP_ENTITY_TOOLS } from "./tools/lookup-entity";
import { toOpenAIToolDefinition, type ToolExecutor } from "./tools/types";

// engineer-46 — tools whose availability depends on the chat session
// context, not the user. Today the only entry is resolve_clarification,
// which only makes sense when the session was opened from a Type E
// clarifying card (chats.clarifyingDraftId IS NOT NULL). The orchestrator
// merges these into the LLM-visible tool list per turn but
// getToolByName(...) still finds them so execution after a deferred
// confirmation works.
const SESSION_SCOPED_TOOLS: ToolExecutor[] = [
  ...(RESOLVE_CLARIFICATION_TOOLS as ToolExecutor[]),
];

export const ALL_TOOLS: ToolExecutor[] = [
  ...(NOTION_TOOLS as ToolExecutor[]),
  ...(CALENDAR_TOOLS as ToolExecutor[]),
  ...(TASKS_TOOLS as ToolExecutor[]),
  ...(CLASSROOM_TOOLS as ToolExecutor[]),
  ...(SYLLABUS_TOOLS as ToolExecutor[]),
  ...(SYLLABUS_EXTRACT_TOOLS as ToolExecutor[]),
  ...(CLASSES_TOOLS as ToolExecutor[]),
  ...(ASSIGNMENTS_TOOLS as ToolExecutor[]),
  ...(ICAL_TOOLS as ToolExecutor[]),
  ...(OFFICE_HOURS_TOOLS as ToolExecutor[]),
  ...(EMAIL_TOOLS as ToolExecutor[]),
  ...(EMAIL_THREAD_TOOLS as ToolExecutor[]),
  ...(CONVERT_TIMEZONE_TOOLS as ToolExecutor[]),
  ...(SAVE_USER_FACT_TOOLS as ToolExecutor[]),
  ...(LOOKUP_ENTITY_TOOLS as ToolExecutor[]),
  summarizeWeekTool as ToolExecutor,
  ...SESSION_SCOPED_TOOLS,
];

export function getToolByName(name: string): ToolExecutor | undefined {
  return ALL_TOOLS.find((t) => t.schema.name === name);
}

export type ChatSessionContext = {
  // engineer-46 — chat opened from a Type E queue card with this
  // ask_clarifying agent_drafts.id as the seed.
  clarifyingDraftId: string | null;
};

// engineer-46 — turn-level tool list. For a normal chat, returns
// everything except SESSION_SCOPED_TOOLS. For a clarification chat,
// includes resolve_clarification so the model can finalize.
export function toolsForChatSession(
  ctx: ChatSessionContext
): ToolExecutor[] {
  if (ctx.clarifyingDraftId) return ALL_TOOLS;
  return ALL_TOOLS.filter(
    (t) => !SESSION_SCOPED_TOOLS.some((s) => s.schema.name === t.schema.name)
  );
}

export function openAIToolDefs(ctx?: ChatSessionContext) {
  // Default (no ctx) = regular chat semantics → drop session-scoped
  // tools. Callers in tests / other surfaces that genuinely want every
  // tool pass `{ clarifyingDraftId: "*" }` explicitly via
  // toolsForChatSession; passing nothing here defends against an
  // accidental exposure of resolve_clarification on a non-clarification
  // chat (which would let any agent invocation dismiss arbitrary
  // drafts).
  const sessionCtx: ChatSessionContext = ctx ?? { clarifyingDraftId: null };
  const tools = toolsForChatSession(sessionCtx);
  return tools.map((t) => toOpenAIToolDefinition(t.schema));
}
