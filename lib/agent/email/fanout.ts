import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  emailEmbeddings,
  inboxItems,
  mistakeNotes,
  type ClassBindingMethod,
} from "@/lib/db/schema";
import {
  fetchUpcomingEvents,
  type DraftCalendarEvent,
} from "@/lib/integrations/google/calendar";
import {
  fetchUpcomingTasks,
  type DraftCalendarTask,
} from "@/lib/integrations/google/tasks";
import { logEmailAudit } from "./audit";
import {
  searchSimilarEmails,
  type SimilarEmail,
} from "./retrieval";

// Per-source caps locked in §12.2 (per-source caps, not a single total
// budget). k_mistakes=3, k_syllabus=3, k_emails=5 (classify) / 20 (deep).
export const FANOUT_K_MISTAKES = 3;
export const FANOUT_K_SYLLABUS = 3;
export const FANOUT_K_EMAILS_CLASSIFY = 5;
export const FANOUT_K_EMAILS_DEEP = 20;

// Calendar windows. §12.10 locked decision: live both classify and draft.
export const FANOUT_CALENDAR_DAYS_CLASSIFY = 3;
export const FANOUT_CALENDAR_DAYS_DRAFT = 7;
export const FANOUT_CALENDAR_MAX_CLASSIFY = 8;
export const FANOUT_CALENDAR_MAX_DRAFT = 25;

// Similarity floor — drop chunks below this from the prompt blocks. §9.2.
const SIM_FLOOR = 0.55;

// Per-source timeout. §4.6: calendar tolerates 100-500ms; structured/vector
// branches finish under 50ms but are wrapped for safety.
const SOURCE_TIMEOUT_MS = 500;

export type FanoutPhase = "classify" | "deep" | "draft";

export type FanoutMistake = {
  mistakeId: string;
  classId: string | null;
  title: string;
  unit: string | null;
  difficulty: string | null;
  bodySnippet: string;
  createdAt: Date;
};

export type FanoutSyllabusChunk = {
  chunkId: string;
  syllabusId: string;
  classId: string | null;
  syllabusTitle: string;
  chunkText: string;
  similarity: number;
};

export type FanoutCalendar = {
  events: DraftCalendarEvent[];
  tasks: DraftCalendarTask[];
};

export type ClassBindingPayload = {
  classId: string | null;
  className: string | null;
  classCode: string | null;
  method: ClassBindingMethod;
  confidence: number;
};

export type FanoutResult = {
  classBinding: ClassBindingPayload;
  mistakes: FanoutMistake[];
  syllabusChunks: FanoutSyllabusChunk[];
  similarEmails: SimilarEmail[];
  totalSimilarCandidates: number;
  calendar: FanoutCalendar;
  // Per-source timing in ms — surfaced in audit logs + admin metrics.
  timings: {
    mistakes: number;
    syllabus: number;
    emails: number;
    calendar: number;
    total: number;
  };
  // Per-source timeouts that fired. Empty when everything completed inside
  // the budget. Surfaces in the email_fanout_timeout audit log.
  timeouts: string[];
};

export type FanoutInput = {
  userId: string;
  inboxItemId: string;
  phase: FanoutPhase;
  // Subject is used as the textual fallback when the cached email_embedding
  // hasn't been written yet (race in the synchronous ingest pipeline that
  // shouldn't fire today, but the fanout guards anyway).
  subject: string | null;
  snippet: string | null;
};

// Top-level fanout orchestrator. Runs all four sources in parallel with
// per-source timeouts, returns a structured result the prompt builders
// consume directly. Failures degrade to empty per-source results — the L2
// pipeline never blocks on a slow query.
export async function fanoutForInbox(
  input: FanoutInput
): Promise<FanoutResult> {
  return Sentry.startSpan(
    {
      name: "email.fanout",
      op: "db.query",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.inbox_item_id": input.inboxItemId,
        "steadii.phase": input.phase,
      },
    },
    async () => runFanout(input)
  );
}

async function runFanout(input: FanoutInput): Promise<FanoutResult> {
  const startedAt = Date.now();

  // Load the inbox row (class binding + cached embedding) in one go. The
  // cached embedding lets us issue ZERO fresh embed API calls per L2 invocation.
  const [row] = await db
    .select({
      classId: inboxItems.classId,
      classBindingMethod: inboxItems.classBindingMethod,
      classBindingConfidence: inboxItems.classBindingConfidence,
      embedding: emailEmbeddings.embedding,
    })
    .from(inboxItems)
    .leftJoin(
      emailEmbeddings,
      eq(emailEmbeddings.inboxItemId, inboxItems.id)
    )
    .where(eq(inboxItems.id, input.inboxItemId))
    .limit(1);

  const classId = row?.classId ?? null;
  const queryEmbedding = row?.embedding ?? null;
  const method: ClassBindingMethod =
    row?.classBindingMethod ?? "none";
  const confidence = row?.classBindingConfidence ?? 0;

  // Resolve class metadata for the provenance payload (one row, cheap).
  let className: string | null = null;
  let classCode: string | null = null;
  if (classId) {
    const [c] = await db
      .select({ name: classes.name, code: classes.code })
      .from(classes)
      .where(eq(classes.id, classId))
      .limit(1);
    className = c?.name ?? null;
    classCode = c?.code ?? null;
  }

  const k_emails =
    input.phase === "deep"
      ? FANOUT_K_EMAILS_DEEP
      : FANOUT_K_EMAILS_CLASSIFY;
  const calendarDays =
    input.phase === "classify"
      ? FANOUT_CALENDAR_DAYS_CLASSIFY
      : FANOUT_CALENDAR_DAYS_DRAFT;
  const calendarMax =
    input.phase === "classify"
      ? FANOUT_CALENDAR_MAX_CLASSIFY
      : FANOUT_CALENDAR_MAX_DRAFT;

  const timeouts: string[] = [];

  // Run all four sources in parallel. Per-source timing tracked individually
  // so admin metrics can surface the long-pole (calendar, usually).
  const [mistakes, syllabusChunks, emails, calendar] = await Promise.all([
    timed("mistakes", async () => {
      if (classId) {
        return loadMistakesByClass(input.userId, classId, FANOUT_K_MISTAKES);
      }
      if (!queryEmbedding) return [];
      return loadVectorMistakes(
        input.userId,
        queryEmbedding,
        FANOUT_K_MISTAKES
      );
    }, timeouts),
    timed("syllabus", async () => {
      if (!queryEmbedding) {
        // No embedding → can't rank; skip.
        return [];
      }
      const rows = classId
        ? await loadSyllabusChunksByClass(
            input.userId,
            classId,
            queryEmbedding,
            FANOUT_K_SYLLABUS
          )
        : await loadVectorSyllabusChunks(
            input.userId,
            queryEmbedding,
            FANOUT_K_SYLLABUS
          );
      return rows.filter((r) => r.similarity >= SIM_FLOOR);
    }, timeouts),
    timed("emails", async () => {
      const queryText =
        (input.subject ?? "").trim() + "\n" + (input.snippet ?? "").trim();
      if (!queryText.trim()) {
        return { results: [] as SimilarEmail[], totalCandidates: 0 };
      }
      // searchSimilarEmails issues its own embed call. We could optimize
      // by passing queryEmbedding directly when present; that's a follow-up
      // (the existing helper has a stable shape and other callers).
      return searchSimilarEmails({
        userId: input.userId,
        queryText,
        topK: k_emails,
        excludeInboxItemId: input.inboxItemId,
      });
    }, timeouts),
    timed(
      "calendar",
      async () => {
        // Both events and tasks live-fetched. Per Addition A, the calendar
        // source is "events + tasks" — fanned out together so the prompt
        // sees the user's full upcoming commitments, not just timed events.
        const [events, tasks] = await Promise.all([
          safelyFetchEvents(input.userId, calendarDays, calendarMax),
          safelyFetchTasks(input.userId, calendarDays, calendarMax),
        ]);
        return { events, tasks };
      },
      timeouts
    ),
  ]);

  const total = Date.now() - startedAt;

  // Audit row — joinable to email_l2_completed by resourceId. The detail
  // payload powers per-source latency / citation rate dashboards (PR 5).
  const detail = {
    phase: input.phase,
    classBinding: { classId, method, confidence },
    counts: {
      mistakes: mistakes.value.length,
      syllabus: syllabusChunks.value.length,
      emails: emails.value.results.length,
      calendar:
        calendar.value.events.length + calendar.value.tasks.length,
    },
    timings_ms: {
      mistakes: mistakes.elapsed,
      syllabus: syllabusChunks.elapsed,
      emails: emails.elapsed,
      calendar: calendar.elapsed,
      total,
    },
    timeouts,
  };
  await logEmailAudit({
    userId: input.userId,
    action: "email_fanout_completed",
    result: "success",
    resourceId: input.inboxItemId,
    detail,
  });
  if (timeouts.length > 0) {
    await logEmailAudit({
      userId: input.userId,
      action: "email_fanout_timeout",
      result: "failure",
      resourceId: input.inboxItemId,
      detail: { phase: input.phase, sources: timeouts },
    });
  }

  return {
    classBinding: {
      classId,
      className,
      classCode,
      method,
      confidence,
    },
    mistakes: mistakes.value,
    syllabusChunks: syllabusChunks.value,
    similarEmails: emails.value.results,
    totalSimilarCandidates: emails.value.totalCandidates,
    calendar: calendar.value,
    timings: {
      mistakes: mistakes.elapsed,
      syllabus: syllabusChunks.elapsed,
      emails: emails.elapsed,
      calendar: calendar.elapsed,
      total,
    },
    timeouts,
  };
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

async function loadMistakesByClass(
  userId: string,
  classId: string,
  k: number
): Promise<FanoutMistake[]> {
  // §12.4 — pure recency for mistakes. Topical rank deferred until α
  // observation shows topical-relevance gap (mistakes pulled but not
  // cited). Logged via email_fanout_completed.detail.counts so the
  // observation lever is in place from day 1.
  const rows = await db
    .select({
      id: mistakeNotes.id,
      classId: mistakeNotes.classId,
      title: mistakeNotes.title,
      unit: mistakeNotes.unit,
      difficulty: mistakeNotes.difficulty,
      bodyMarkdown: mistakeNotes.bodyMarkdown,
      createdAt: mistakeNotes.createdAt,
    })
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.userId, userId),
        eq(mistakeNotes.classId, classId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .orderBy(desc(mistakeNotes.createdAt))
    .limit(k);
  return rows.map((r) => ({
    mistakeId: r.id,
    classId: r.classId,
    title: r.title,
    unit: r.unit,
    difficulty: r.difficulty,
    bodySnippet: r.bodyMarkdown ?? "",
    createdAt: r.createdAt,
  }));
}

async function loadVectorMistakes(
  userId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutMistake[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  const rowsRes = await db.execute<{
    mistake_id: string;
    class_id: string | null;
    title: string;
    unit: string | null;
    difficulty: string | null;
    body_markdown: string | null;
    created_at: Date | string;
    distance: number;
  }>(sql`
    SELECT DISTINCT ON (mn.id)
      mn.id AS mistake_id,
      mn.class_id AS class_id,
      mn.title AS title,
      mn.unit AS unit,
      mn.difficulty AS difficulty,
      mn.body_markdown AS body_markdown,
      mn.created_at AS created_at,
      (mc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM mistake_note_chunks mc
    JOIN mistake_notes mn ON mn.id = mc.mistake_id
    WHERE mc.user_id = ${userId}
      AND mn.deleted_at IS NULL
    ORDER BY mn.id, mc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 4}
  `);
  const raw = (rowsRes as unknown as {
    rows: Array<{
      mistake_id: string;
      class_id: string | null;
      title: string;
      unit: string | null;
      difficulty: string | null;
      body_markdown: string | null;
      created_at: Date | string;
      distance: number;
    }>;
  }).rows ?? [];
  // Re-sort by distance ascending across the de-duped mistake set, then
  // cap at k. The DISTINCT ON above gives us the best chunk per mistake.
  raw.sort((a, b) => Number(a.distance) - Number(b.distance));
  return raw.slice(0, k).map((r) => ({
    mistakeId: r.mistake_id,
    classId: r.class_id,
    title: r.title,
    unit: r.unit,
    difficulty: r.difficulty,
    bodySnippet: r.body_markdown ?? "",
    createdAt:
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

async function loadSyllabusChunksByClass(
  userId: string,
  classId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutSyllabusChunk[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  // Fetch more than k so dedup-by-syllabus_id can still return k distinct
  // syllabi when available.
  const rowsRes = await db.execute<{
    chunk_id: string;
    syllabus_id: string;
    class_id: string | null;
    syllabus_title: string;
    chunk_text: string;
    distance: number;
  }>(sql`
    SELECT
      sc.id AS chunk_id,
      sc.syllabus_id AS syllabus_id,
      s.class_id AS class_id,
      s.title AS syllabus_title,
      sc.chunk_text AS chunk_text,
      (sc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM syllabus_chunks sc
    JOIN syllabi s ON s.id = sc.syllabus_id
    WHERE sc.user_id = ${userId}
      AND s.class_id = ${classId}
      AND s.deleted_at IS NULL
    ORDER BY sc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 3}
  `);
  return dedupSyllabusChunks(parseSyllabusRows(rowsRes), k);
}

async function loadVectorSyllabusChunks(
  userId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutSyllabusChunk[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  const rowsRes = await db.execute<{
    chunk_id: string;
    syllabus_id: string;
    class_id: string | null;
    syllabus_title: string;
    chunk_text: string;
    distance: number;
  }>(sql`
    SELECT
      sc.id AS chunk_id,
      sc.syllabus_id AS syllabus_id,
      s.class_id AS class_id,
      s.title AS syllabus_title,
      sc.chunk_text AS chunk_text,
      (sc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM syllabus_chunks sc
    JOIN syllabi s ON s.id = sc.syllabus_id
    WHERE sc.user_id = ${userId}
      AND s.deleted_at IS NULL
    ORDER BY sc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 3}
  `);
  return dedupSyllabusChunks(parseSyllabusRows(rowsRes), k);
}

function parseSyllabusRows(
  rowsRes: unknown
): FanoutSyllabusChunk[] {
  const raw = (rowsRes as {
    rows: Array<{
      chunk_id: string;
      syllabus_id: string;
      class_id: string | null;
      syllabus_title: string;
      chunk_text: string;
      distance: number;
    }>;
  }).rows ?? [];
  return raw.map((r) => ({
    chunkId: r.chunk_id,
    syllabusId: r.syllabus_id,
    classId: r.class_id,
    syllabusTitle: r.syllabus_title,
    chunkText: r.chunk_text,
    similarity: distanceToSimilarity(Number(r.distance)),
  }));
}

// Dedup §4.5 — at most one chunk per syllabus_id, in similarity-rank
// order. Caps at k.
function dedupSyllabusChunks(
  rows: FanoutSyllabusChunk[],
  k: number
): FanoutSyllabusChunk[] {
  const seen = new Set<string>();
  const out: FanoutSyllabusChunk[] = [];
  for (const r of rows) {
    if (seen.has(r.syllabusId)) continue;
    seen.add(r.syllabusId);
    out.push(r);
    if (out.length >= k) break;
  }
  return out;
}

async function safelyFetchEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchUpcomingEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchTasks(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarTask[]> {
  try {
    return await fetchUpcomingTasks(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_tasks" },
      user: { id: userId },
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type Timed<T> = { value: T; elapsed: number; timedOut: boolean };

async function timed<T>(
  source: string,
  fn: () => Promise<T>,
  timeouts: string[]
): Promise<Timed<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const empty: T = emptyForSource(source) as T;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          timeouts.push(source);
          resolve(empty);
        }, SOURCE_TIMEOUT_MS);
      }),
    ]);
    return { value, elapsed: Date.now() - startedAt, timedOut: false };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source },
    });
    return { value: empty, elapsed: Date.now() - startedAt, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyForSource(source: string): unknown {
  switch (source) {
    case "mistakes":
      return [] as FanoutMistake[];
    case "syllabus":
      return [] as FanoutSyllabusChunk[];
    case "emails":
      return { results: [] as SimilarEmail[], totalCandidates: 0 };
    case "calendar":
      return { events: [] as DraftCalendarEvent[], tasks: [] as DraftCalendarTask[] };
    default:
      return null;
  }
}

function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance / 2;
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}
