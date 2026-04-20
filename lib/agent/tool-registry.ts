import "server-only";
import { NOTION_TOOLS } from "./tools/notion";
import { CALENDAR_TOOLS } from "./tools/calendar";
import { SYLLABUS_TOOLS } from "./tools/syllabus";
import { toOpenAIToolDefinition, type ToolExecutor } from "./tools/types";

export const ALL_TOOLS: ToolExecutor[] = [
  ...(NOTION_TOOLS as ToolExecutor[]),
  ...(CALENDAR_TOOLS as ToolExecutor[]),
  ...(SYLLABUS_TOOLS as ToolExecutor[]),
];

export function getToolByName(name: string): ToolExecutor | undefined {
  return ALL_TOOLS.find((t) => t.schema.name === name);
}

export function openAIToolDefs() {
  return ALL_TOOLS.map((t) => toOpenAIToolDefinition(t.schema));
}
