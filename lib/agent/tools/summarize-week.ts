import "server-only";
import { z } from "zod";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { db } from "@/lib/db/client";
import { chats, messages, usageEvents } from "@/lib/db/schema";
import { and, eq, gte, isNull } from "drizzle-orm";
import type { ToolExecutor } from "./types";

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
  const { mistakeTitles, mistakeClasses, syllabusCount } = await countNotion(
    userId,
    weekAgo
  );

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

async function countChatsThisWeek(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.userId, userId),
        isNull(chats.deletedAt),
        gte(chats.updatedAt, since)
      )
    );
  return rows.length;
}

async function countNotion(
  userId: string,
  since: Date
): Promise<{ mistakeTitles: string[]; mistakeClasses: string[]; syllabusCount: number }> {
  const notion = await getNotionClientForUser(userId);
  if (!notion) {
    return { mistakeTitles: [], mistakeClasses: [], syllabusCount: 0 };
  }
  const { client, connection } = notion;
  const mistakeTitles: string[] = [];
  const mistakeClasses: string[] = [];
  let syllabusCount = 0;

  if (connection.mistakesDbId) {
    try {
      const dsId = await resolveDataSourceId(client, connection.mistakesDbId);
      const resp = await client.dataSources.query({
        data_source_id: dsId,
        page_size: 50,
        filter: {
          timestamp: "created_time",
          created_time: { on_or_after: since.toISOString() },
        },
      });
      for (const page of resp.results as Array<Record<string, unknown>>) {
        const props = (page as { properties?: Record<string, unknown> }).properties ?? {};
        const title = extractTitle(props);
        if (title) mistakeTitles.push(title);
        const cls = extractClassRelation(props);
        if (cls) mistakeClasses.push(cls);
      }
    } catch {
      // Swallow — partial data is fine for this advisory summary.
    }
  }

  if (connection.syllabiDbId) {
    try {
      const dsId = await resolveDataSourceId(client, connection.syllabiDbId);
      const resp = await client.dataSources.query({
        data_source_id: dsId,
        page_size: 50,
        filter: {
          timestamp: "created_time",
          created_time: { on_or_after: since.toISOString() },
        },
      });
      syllabusCount = resp.results.length;
    } catch {
      // ignore
    }
  }

  return { mistakeTitles, mistakeClasses, syllabusCount };
}

function extractTitle(props: Record<string, unknown>): string | null {
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === "title" && Array.isArray(v.title) && v.title.length) {
      return v.title.map((t) => t.plain_text ?? "").join("").trim() || null;
    }
  }
  return null;
}

function extractClassRelation(props: Record<string, unknown>): string | null {
  const maybe = props["Class"] as
    | { type?: string; relation?: Array<{ id?: string }> }
    | undefined;
  if (maybe?.type === "relation" && Array.isArray(maybe.relation) && maybe.relation[0]?.id) {
    return maybe.relation[0].id;
  }
  return null;
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
