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
import { toOpenAIToolDefinition, type ToolExecutor } from "./tools/types";

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
  summarizeWeekTool as ToolExecutor,
];

export function getToolByName(name: string): ToolExecutor | undefined {
  return ALL_TOOLS.find((t) => t.schema.name === name);
}

export function openAIToolDefs() {
  return ALL_TOOLS.map((t) => toOpenAIToolDefinition(t.schema));
}
