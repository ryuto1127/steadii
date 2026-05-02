import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  classOfficeHours,
  officeHoursRequests,
  syllabi,
  type OfficeHoursCandidateSlot,
  type OfficeHoursRequestRow,
} from "@/lib/db/schema";
import { compileOfficeHoursQuestions } from "./compile-questions";
import { expandSlotToDates, extractOfficeHours } from "./extract";

// Wave 3.3 — orchestration that ties extraction + compilation +
// candidate-slot expansion + persistence into a single call.
//
// Entry point: createOfficeHoursRequest({ userId, classRefHint, topic })
//   - Resolves the class (by code/name match or explicit class_id)
//   - Loads or LLM-extracts office hours slots
//   - Picks 3 candidate dates from the next 14 days
//   - Compiles 3-5 relevant questions
//   - Persists an `office_hours_requests` row in status='pending'
//   - Returns the row id so the queue refresh surfaces the Type A card

export type CreateOfficeHoursInput = {
  userId: string;
  // Free-form class hint — class code, class name, or "my MAT223 prof".
  classRefHint: string;
  topic: string | null;
};

export type CreateOfficeHoursResult = {
  id: string;
  status: "created" | "no_class_match" | "no_office_hours";
  pendingRow?: OfficeHoursRequestRow;
};

const CANDIDATE_HORIZON_DAYS = 14;
const CANDIDATE_COUNT = 3;

export async function createOfficeHoursRequest(
  input: CreateOfficeHoursInput
): Promise<CreateOfficeHoursResult> {
  const cls = await resolveClass(input.userId, input.classRefHint);
  if (!cls) {
    return { id: "", status: "no_class_match" };
  }

  const oh = await loadOrExtractOfficeHours(input.userId, cls.id);
  const slots = oh?.slots ?? [];

  const candidates = expandCandidateSlots(slots);
  if (candidates.length === 0) {
    return { id: "", status: "no_office_hours" };
  }

  const compiled = await compileOfficeHoursQuestions({
    userId: input.userId,
    classId: cls.id,
    professorEmail: oh?.professorEmail ?? cls.professorEmail ?? null,
    topic: input.topic,
  });

  const [created] = await db
    .insert(officeHoursRequests)
    .values({
      userId: input.userId,
      classId: cls.id,
      professorEmail: oh?.professorEmail ?? cls.professorEmail ?? null,
      professorName: oh?.professorName ?? cls.professorName ?? null,
      topic: input.topic,
      candidateSlots: candidates,
      compiledQuestions: compiled,
      status: "pending",
    })
    .returning();
  if (!created) throw new Error("Failed to create office_hours_request");
  return { id: created.id, status: "created", pendingRow: created };
}

// ── Helpers ──────────────────────────────────────────────────────────

type ResolvedClass = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
  professorEmail: string | null;
  professorName: string | null;
};

async function resolveClass(
  userId: string,
  hint: string
): Promise<ResolvedClass | null> {
  const cleanedHint = hint.toLowerCase().trim();
  const all = await db
    .select()
    .from(classes)
    .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)));
  // Prefer exact code match.
  let cls =
    all.find(
      (c) => c.code && cleanedHint.includes(c.code.toLowerCase())
    ) ?? null;
  if (!cls) {
    cls =
      all.find((c) =>
        c.name.toLowerCase().split(/\s+/).some((w) => cleanedHint.includes(w))
      ) ?? null;
  }
  if (!cls) return null;
  return {
    id: cls.id,
    name: cls.name,
    code: cls.code,
    professor: cls.professor,
    // The Phase 1 classes table stores professor as text — we don't have
    // a structured email yet. The extraction below populates the
    // class_office_hours.professor_email column when present.
    professorEmail: looksLikeEmail(cls.professor) ? cls.professor : null,
    professorName: cls.professor && !looksLikeEmail(cls.professor) ? cls.professor : null,
  };
}

function looksLikeEmail(s: string | null): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function loadOrExtractOfficeHours(
  userId: string,
  classId: string
): Promise<{
  slots: typeof classOfficeHours.$inferSelect.slots;
  professorEmail: string | null;
  professorName: string | null;
} | null> {
  const [existing] = await db
    .select()
    .from(classOfficeHours)
    .where(
      and(
        eq(classOfficeHours.userId, userId),
        eq(classOfficeHours.classId, classId)
      )
    )
    .orderBy(sql`${classOfficeHours.extractedAt} desc`)
    .limit(1);
  if (existing && existing.slots.length > 0) {
    return {
      slots: existing.slots,
      professorEmail: existing.professorEmail,
      professorName: existing.professorName,
    };
  }

  // Pull syllabus.officeHours for fallback extraction.
  const [syl] = await db
    .select({
      id: syllabi.id,
      officeHours: syllabi.officeHours,
    })
    .from(syllabi)
    .where(
      and(
        eq(syllabi.userId, userId),
        eq(syllabi.classId, classId),
        isNull(syllabi.deletedAt)
      )
    )
    .orderBy(sql`${syllabi.createdAt} desc`)
    .limit(1);
  if (!syl?.officeHours) return null;

  const extracted = await extractOfficeHours({
    userId,
    text: syl.officeHours,
  });

  // Cache.
  await db.insert(classOfficeHours).values({
    userId,
    classId,
    syllabusId: syl.id,
    professorEmail: extracted.professorEmail,
    professorName: null,
    slots: extracted.slots,
    rawNote: extracted.rawNote,
    bookingUrl: extracted.bookingUrl,
  });

  return {
    slots: extracted.slots,
    professorEmail: extracted.professorEmail,
    professorName: null,
  };
}

function expandCandidateSlots(
  slots: typeof classOfficeHours.$inferSelect.slots
): OfficeHoursCandidateSlot[] {
  if (slots.length === 0) return [];
  const fromDate = new Date();
  const horizon = new Date(
    fromDate.getTime() + CANDIDATE_HORIZON_DAYS * 24 * 60 * 60 * 1000
  );
  const out: OfficeHoursCandidateSlot[] = [];
  for (const slot of slots) {
    const dates = expandSlotToDates(slot, fromDate, CANDIDATE_COUNT * 2);
    for (const d of dates) {
      if (d.startsAt > horizon) break;
      out.push({
        startsAt: d.startsAt.toISOString(),
        endsAt: d.endsAt.toISOString(),
        location: d.location,
      });
      if (out.length >= CANDIDATE_COUNT) break;
    }
    if (out.length >= CANDIDATE_COUNT) break;
  }
  // Sort by startsAt ascending.
  return out
    .slice(0, CANDIDATE_COUNT)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
