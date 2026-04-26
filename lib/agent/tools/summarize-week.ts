import "server-only";
import { z } from "zod";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { db } from "@/lib/db/client";
import {
  chats,
  messages,
  mistakeNotes,
  syllabi,
  usageEvents,
} from "@/lib/db/schema";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { ToolExecutor } from "./types";

// A chat counts as a "study session" only when the agent did work
// in an academic surface. Utility tool calls (Gmail triage, calendar
// CRUD, Google Tasks) inflate the metric without representing study
// activity, so they're excluded. Grow this list when new academic
// tools land — keep it explicit rather than blanket-including
// everything-but-utility, so a new utility tool added in the future
// doesn't silently start counting.
export const ACADEMIC_TOOL_NAMES = [
  "summarize_week",
  "read_syllabus_full_text",
  "classroom_list_courses",
  "classroom_list_coursework",
  "classroom_list_announcements",
  // Notion is the canonical knowledge-management surface, treat any
  // notion_* invocation as academic activity for v1
  "notion_search_pages",
  "notion_get_page",
  "notion_create_page",
  "notion_update_page",
  "notion_delete_page",
  "notion_query_database",
  "notion_create_row",
  "notion_update_row",
] as const;

export type WeekSummary = {
  window: { start: string; end: string };
  counts: { chats: number; mistakes: number; syllabi: number };
  focus: string[];
  pattern: string;
  empty: boolean;
};

// In-memory cache. Keyed by userId. Evicted after 6h per §4.3 Card 3.
const CACHE = new Map<string, { expiresAt: number; value: WeekSummary }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function clearSummarizeWeekCache(userId?: string) {
  if (userId) CACHE.delete(userId);
  else CACHE.clear();
}

export async function computeWeekSummary(userId: string): Promise<WeekSummary> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const hit = CACHE.get(userId);
  if (hit && hit.expiresAt > now.getTime()) return hit.value;

  const chatCount = await countChatsThisWeek(userId, weekAgo);
  const { mistakeTitles, mistakeClasses, syllabusCount } =
    await countAcademicEntities(userId, weekAgo);

  const focus = topClasses(mistakeClasses, 2);
  const mistakesN = mistakeTitles.length;
  const empty = chatCount + mistakesN + syllabusCount < 3;

  let pattern = "";
  if (!empty) {
    pattern = await generatePattern({ titles: mistakeTitles, focus });
  }

  const value: WeekSummary = {
    window: {
      start: weekAgo.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    },
    counts: { chats: chatCount, mistakes: mistakesN, syllabi: syllabusCount },
    focus,
    pattern,
    empty,
  };

  CACHE.set(userId, { value, expiresAt: now.getTime() + CACHE_TTL_MS });
  return value;
}

// A chat counts as a "study session" only when the agent invoked an
// academic tool inside it (see ACADEMIC_TOOL_NAMES). Utility tool calls
// (Gmail triage, calendar CRUD, Google Tasks) are excluded so chats about
// email or scheduling don't inflate the dashboard "Study sessions" count.
// One qualifying chat = one session for the week, regardless of how many
// academic tool calls it contains. We check `messages.tool_calls` on the
// originating assistant rows (the canonical record of what the agent did)
// rather than the `role: "tool"` reply rows.
async function countChatsThisWeek(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${chats.id})` })
    .from(chats)
    .innerJoin(messages, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.userId, userId),
        isNull(chats.deletedAt),
        gte(messages.createdAt, since),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${messages.toolCalls}) AS tc
          WHERE tc->'function'->>'name' = ANY(${sql.raw(
            `ARRAY[${ACADEMIC_TOOL_NAMES.map((n) => `'${n}'`).join(",")}]::text[]`
          )})
        )`
      )
    );
  return Number(row?.count ?? 0);
}

async function countAcademicEntities(
  userId: string,
  since: Date
): Promise<{
  mistakeTitles: string[];
  mistakeClasses: string[];
  syllabusCount: number;
}> {
  const [mistakeRows, syllabusRows] = await Promise.all([
    db
      .select({
        title: mistakeNotes.title,
        classId: mistakeNotes.classId,
      })
      .from(mistakeNotes)
      .where(
        and(
          eq(mistakeNotes.userId, userId),
          isNull(mistakeNotes.deletedAt),
          gte(mistakeNotes.createdAt, since)
        )
      )
      .limit(50),
    db
      .select({ id: syllabi.id })
      .from(syllabi)
      .where(
        and(
          eq(syllabi.userId, userId),
          isNull(syllabi.deletedAt),
          gte(syllabi.createdAt, since)
        )
      )
      .limit(50),
  ]);

  const mistakeTitles = mistakeRows.map((r) => r.title);
  const mistakeClasses = mistakeRows
    .map((r) => r.classId)
    .filter((id): id is string => Boolean(id));

  return {
    mistakeTitles,
    mistakeClasses,
    syllabusCount: syllabusRows.length,
  };
}

function topClasses(classIds: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const id of classIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

async function generatePattern(input: {
  titles: string[];
  focus: string[];
}): Promise<string> {
  if (input.titles.length === 0) return "";
  const model = selectModel("tag_suggest");
  try {
    const client = openai();
    const prompt = [
      "You summarize a student's past-week study patterns in one or two concise lines.",
      "Respond in the same language as the titles below. Be factual, not cheerful.",
      "No leading labels, no quotes, under 90 characters total.",
    ].join(" ");
    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Recent mistake titles:\n${input.titles
            .slice(0, 10)
            .map((t) => `- ${t}`)
            .join("\n")}`,
        },
      ],
    });
    const text = (resp as unknown as { output_text?: string }).output_text ?? "";
    return text.trim().slice(0, 160);
  } catch {
    return "";
  }
}

// Separately export a tool executor so the agent can call it.
const args = z.object({});

export const summarizeWeekTool: ToolExecutor<z.infer<typeof args>, WeekSummary> = {
  schema: {
    name: "summarize_week",
    description:
      "Summarize the current user's past 7 days of academic activity — chat count, mistake-note count, syllabus count, top classes, and a one-line pattern observation. Cached for 6 hours. Used by the Home dashboard and may also be called in chat when the user asks about their recent activity.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  async execute(ctx) {
    return computeWeekSummary(ctx.userId);
  },
};

// Unused import guard (usageEvents is available for future expansion).
void usageEvents;
void messages;
