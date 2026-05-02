import "server-only";
import { and, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  chats,
  inboxItems,
  messages,
  mistakeNotes,
  type OfficeHoursCompiledQuestion,
} from "@/lib/db/schema";

// Wave 3.3 — pure orchestration. No new LLM call.
//
// Aggregates 3-5 questions from:
//   - Recent mistake notes referencing the topic
//   - Unresolved emails with the prof referencing the topic
//   - Recent chats (the user typed something the topic appeared in)
//   - Open assignments / tasks in the relevant class
//
// Topic match is a simple substring check. The LLM tool that triggered
// this should pass a normalized topic (e.g. "ch4" not "chapter 4 §3.4
// linear-transform example") so the substring check has high recall.

export type CompileInput = {
  userId: string;
  classId: string | null;
  professorEmail: string | null;
  topic: string | null;
  // Time window (days) for "recent" lookups across the sources.
  withinDays?: number;
};

export async function compileOfficeHoursQuestions(
  args: CompileInput
): Promise<OfficeHoursCompiledQuestion[]> {
  const within = args.withinDays ?? 30;
  const since = new Date(Date.now() - within * 24 * 60 * 60 * 1000);
  const topic = (args.topic ?? "").trim().toLowerCase();

  const [mistakeQs, emailQs, chatQs, taskQs] = await Promise.all([
    fetchMistakeQuestions(args.userId, args.classId, topic, since),
    fetchEmailQuestions(args.userId, args.professorEmail, topic, since),
    fetchChatQuestions(args.userId, topic, since),
    fetchTaskQuestions(args.userId, args.classId, topic, since),
  ]);

  // Merge and dedup by label.
  const all = [...mistakeQs, ...emailQs, ...chatQs, ...taskQs];
  const seen = new Set<string>();
  const out: OfficeHoursCompiledQuestion[] = [];
  for (const q of all) {
    const k = q.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= 5) break;
  }
  return out;
}

async function fetchMistakeQuestions(
  userId: string,
  classId: string | null,
  topic: string,
  since: Date
): Promise<OfficeHoursCompiledQuestion[]> {
  const conds = [
    eq(mistakeNotes.userId, userId),
    isNull(mistakeNotes.deletedAt),
    gte(mistakeNotes.createdAt, since),
  ];
  if (classId) conds.push(eq(mistakeNotes.classId, classId));
  const rows = await db
    .select({
      id: mistakeNotes.id,
      title: mistakeNotes.title,
      unit: mistakeNotes.unit,
      bodyMarkdown: mistakeNotes.bodyMarkdown,
    })
    .from(mistakeNotes)
    .where(and(...conds))
    .orderBy(desc(mistakeNotes.createdAt))
    .limit(20);

  return rows
    .filter((r) =>
      topic.length === 0 || matchesTopic(`${r.title} ${r.unit ?? ""} ${r.bodyMarkdown ?? ""}`, topic)
    )
    .slice(0, 3)
    .map((r) => ({
      label: r.unit ? `${r.title} (${r.unit})` : r.title,
      source: "mistake" as const,
      href: `/app/mistakes/${r.id}`,
    }));
}

async function fetchEmailQuestions(
  userId: string,
  professorEmail: string | null,
  topic: string,
  since: Date
): Promise<OfficeHoursCompiledQuestion[]> {
  if (!professorEmail) return [];
  const rows = await db
    .select({
      id: inboxItems.id,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      status: inboxItems.status,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.senderEmail, professorEmail),
        ne(inboxItems.status, "archived"),
        ne(inboxItems.status, "sent"),
        gte(inboxItems.receivedAt, since),
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(desc(inboxItems.receivedAt))
    .limit(20);
  return rows
    .filter((r) =>
      topic.length === 0 || matchesTopic(`${r.subject ?? ""} ${r.snippet ?? ""}`, topic)
    )
    .slice(0, 2)
    .map((r) => ({
      label: r.subject ?? "(no subject)",
      source: "email" as const,
      href: `/app/inbox/${r.id}`,
    }));
}

async function fetchChatQuestions(
  userId: string,
  topic: string,
  since: Date
): Promise<OfficeHoursCompiledQuestion[]> {
  if (topic.length === 0) return [];
  const rows = await db
    .select({
      id: messages.id,
      content: messages.content,
      chatId: messages.chatId,
    })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(
      and(
        eq(chats.userId, userId),
        eq(messages.role, "user"),
        gte(messages.createdAt, since),
        sql`lower(${messages.content}) like ${"%" + topic + "%"}`
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(3);
  return rows.map((r) => ({
    label: truncate(r.content ?? "", 120),
    source: "chat" as const,
    href: `/app/chat/${r.chatId}`,
  }));
}

async function fetchTaskQuestions(
  userId: string,
  classId: string | null,
  topic: string,
  since: Date
): Promise<OfficeHoursCompiledQuestion[]> {
  void since;
  const conds = [
    eq(assignments.userId, userId),
    isNull(assignments.deletedAt),
    ne(assignments.status, "done"),
  ];
  if (classId) conds.push(eq(assignments.classId, classId));
  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      notes: assignments.notes,
    })
    .from(assignments)
    .where(and(...conds))
    .limit(10);
  return rows
    .filter((r) =>
      topic.length === 0 || matchesTopic(`${r.title} ${r.notes ?? ""}`, topic)
    )
    .slice(0, 2)
    .map((r) => ({
      label: r.title,
      source: "task" as const,
      href: `/app/tasks#${r.id}`,
    }));
}

export function matchesTopic(haystack: string, topic: string): boolean {
  if (topic.length === 0) return true;
  const lower = haystack.toLowerCase();
  const t = topic.toLowerCase();
  if (lower.includes(t)) return true;
  // "ch4" should also match "chapter 4" (and vice versa). Cheap rewrite.
  const chMatch = t.match(/^ch\s*(\d+)$/);
  if (chMatch) {
    const num = chMatch[1];
    if (lower.includes(`chapter ${num}`)) return true;
    if (lower.includes(`§${num}`)) return true;
  }
  const chapterMatch = t.match(/^chapter\s*(\d+)$/);
  if (chapterMatch) {
    if (lower.includes(`ch${chapterMatch[1]}`)) return true;
    if (lower.includes(`ch ${chapterMatch[1]}`)) return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Helpers exported for tests / imported by other modules in the same
// feature.
export { or };
