import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  type ClassBindingMethod,
  type SenderRole,
} from "@/lib/db/schema";
import {
  COURSE_CODE_PATTERNS_JA,
  KANJI_COURSE_NAMES_JA,
} from "./rules-global";

// Confidence floor — if no method clears this, we leave the row unbound and
// let the L2 fanout fall back to vector-only retrieval. The 0.85 short-
// circuit floor is deliberately separate (a method clearing 0.85 wins
// outright without checking lower-precision methods).
const MIN_CONFIDENCE = 0.4;
const SHORT_CIRCUIT_CONFIDENCE = 0.85;

// Vector-binding parameters. We pull the top-K syllabus chunks and the top-K
// mistake chunks for the user, then aggregate by class_id. A class wins if
// it accounts for ≥ DOMINANT_FRACTION of the top-K chunks AND its top
// similarity is ≥ VECTOR_MIN_SIM.
const VECTOR_TOP_K = 6;
const VECTOR_MIN_SIM = 0.55; // same floor as fanout (§9.2)
const DOMINANT_FRACTION = 0.5; // half or more of the top-K must agree

// Helpers shared with the binding methods.
const SUBJECT_CODE_RE = /\b[A-Z]{2,4}-?\d{2,4}[A-Z]?\d?\b/gi;
// 〇〇先生 honorific — captures up to 5 CJK characters preceding 先生 so we
// can cross-reference against `classes.professor`. The Unicode-property
// classes need the /u flag.
const JA_SENSEI_RE =
  /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,5})先生/u;

export type ClassBindingResult = {
  classId: string | null;
  confidence: number; // 0..1
  method: ClassBindingMethod;
  // Methods that agreed but didn't dominate. Ranked highest-confidence
  // first. Empty in the no-class case.
  alternates: Array<{
    classId: string;
    confidence: number;
    method: ClassBindingMethod;
  }>;
};

export type BindEmailToClassInput = {
  userId: string;
  subject: string | null;
  bodySnippet: string | null;
  senderEmail: string;
  senderName: string | null;
  senderRole: SenderRole | null;
  // Pre-fetched query embedding (reused from email_embeddings to save one
  // API call). Pass null only when missing — the function will skip the
  // vector branch and fall back to structured-only signals.
  queryEmbedding: number[] | null;
};

type ClassRow = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
};

type Candidate = {
  classId: string;
  confidence: number;
  method: ClassBindingMethod;
};

// Pure binding compute. Reads classes + chunk tables; never writes. The
// caller is responsible for persisting the result onto inbox_items.
export async function bindEmailToClass(
  input: BindEmailToClassInput
): Promise<ClassBindingResult> {
  const userClasses = await loadUserClasses(input.userId);
  if (userClasses.length === 0) {
    return noneResult();
  }

  const candidates: Candidate[] = [];

  // Method 1 — exact code match in subject. Highest precision.
  const subjectCodeHit = matchSubjectCode(input.subject, userClasses);
  if (subjectCodeHit) candidates.push(subjectCodeHit);

  // Method 1b — exact class-name substring (covers JP kanji course names
  // populated into classes.code OR classes.name).
  const subjectNameHit = matchSubjectName(input.subject, userClasses);
  if (subjectNameHit) candidates.push(subjectNameHit);

  // Method 2 — sender is a registered prof/TA whose name shows up in
  // classes.professor for one of the user's classes.
  const senderHit = matchSenderProfessor(
    input.senderEmail,
    input.senderName,
    input.senderRole,
    userClasses
  );
  if (senderHit) candidates.push(senderHit);

  // Method 5 — JA 〇〇先生 honorific in subject or body, cross-referenced
  // against classes.professor.
  const senseiHit = matchSenseiPattern(
    input.subject,
    input.bodySnippet,
    userClasses
  );
  if (senseiHit) candidates.push(senseiHit);

  // Short-circuit if any deterministic method already dominates.
  const top = bestOf(candidates);
  if (top && top.confidence >= SHORT_CIRCUIT_CONFIDENCE) {
    return finalize(top, candidates);
  }

  // Method 3 — vector similarity over syllabus + mistake chunks. Only run
  // when we have a query embedding and no high-confidence structured hit.
  if (input.queryEmbedding && input.queryEmbedding.length > 0) {
    const vectorHit = await matchVectorChunks(
      input.userId,
      input.queryEmbedding
    );
    if (vectorHit) candidates.push(vectorHit);
  }

  const final = bestOf(candidates);
  if (!final || final.confidence < MIN_CONFIDENCE) {
    return noneResult();
  }
  return finalize(final, candidates);
}

// Persist the binding back onto the inbox row. Caller decides whether to
// run this — separating the compute from the write makes it easy to dry-
// run the binding from a backfill script or test harness.
export async function persistBinding(
  inboxItemId: string,
  result: ClassBindingResult
): Promise<void> {
  const { inboxItems } = await import("@/lib/db/schema");
  await db
    .update(inboxItems)
    .set({
      classId: result.classId,
      classBindingMethod: result.method,
      classBindingConfidence: result.confidence,
      updatedAt: new Date(),
    })
    .where(eq(inboxItems.id, inboxItemId));
}

// ---------------------------------------------------------------------------
// Binding methods
// ---------------------------------------------------------------------------

function matchSubjectCode(
  subject: string | null,
  userClasses: ClassRow[]
): Candidate | null {
  if (!subject) return null;
  const upper = subject.toUpperCase();

  // Try classes.code as a word-boundary anchor first (very high precision).
  for (const c of userClasses) {
    const code = (c.code ?? "").trim();
    if (!code) continue;
    if (matchesAsWord(upper, code.toUpperCase())) {
      return {
        classId: c.id,
        confidence: 0.95,
        method: "subject_code",
      };
    }
  }

  // No class code matched. Try generic course-code regex hits AND JA
  // operator-curated patterns. If a regex match resembles a class.code
  // for one of the user's classes (case-insensitive), surface it.
  const regexHits = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(SUBJECT_CODE_RE.source, "gi");
  while ((m = re.exec(subject)) !== null) regexHits.add(m[0].toUpperCase());
  for (const pat of COURSE_CODE_PATTERNS_JA) {
    const reJa = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : `${pat.flags}g`);
    while ((m = reJa.exec(subject)) !== null) regexHits.add(m[0]);
  }

  for (const c of userClasses) {
    const code = (c.code ?? "").trim().toUpperCase();
    if (!code) continue;
    if (regexHits.has(code)) {
      return {
        classId: c.id,
        confidence: 0.9,
        method: "subject_code",
      };
    }
  }

  return null;
}

function matchSubjectName(
  subject: string | null,
  userClasses: ClassRow[]
): Candidate | null {
  if (!subject) return null;
  const lower = subject.toLowerCase();

  for (const c of userClasses) {
    const name = c.name.trim();
    if (name.length < 3) continue; // too noisy
    if (lower.includes(name.toLowerCase())) {
      return {
        classId: c.id,
        confidence: 0.85,
        method: "subject_name",
      };
    }
  }

  // JA kanji-course-name fallback: if the subject contains a known kanji
  // course name AND that name appears in classes.code or classes.name, bind.
  for (const word of KANJI_COURSE_NAMES_JA) {
    if (!subject.includes(word)) continue;
    for (const c of userClasses) {
      const haystack = `${c.name} ${c.code ?? ""}`;
      if (haystack.includes(word)) {
        return {
          classId: c.id,
          confidence: 0.8,
          method: "subject_name",
        };
      }
    }
  }
  return null;
}

function matchSenderProfessor(
  senderEmail: string,
  senderName: string | null,
  senderRole: SenderRole | null,
  userClasses: ClassRow[]
): Candidate | null {
  if (senderRole !== "professor" && senderRole !== "ta") return null;
  const local = (senderEmail.split("@")[0] ?? "").toLowerCase();
  const name = (senderName ?? "").trim().toLowerCase();

  // Boost only — we don't hard-bind off this signal because a single prof
  // can teach multiple classes. v1: pick the first (only) match. If the
  // user has two classes with the same prof, ranking falls through to
  // vector chunks.
  let firstHit: ClassRow | null = null;
  let hitCount = 0;
  for (const c of userClasses) {
    const prof = (c.professor ?? "").trim().toLowerCase();
    if (!prof) continue;
    if (
      (name && prof.includes(name)) ||
      (local && prof.includes(local))
    ) {
      firstHit ??= c;
      hitCount++;
    }
  }
  if (!firstHit) return null;

  // Multiple matches → ambiguous, downweight; single match → confident.
  return {
    classId: firstHit.id,
    confidence: hitCount === 1 ? 0.75 : 0.5,
    method: "sender_professor",
  };
}

function matchSenseiPattern(
  subject: string | null,
  bodySnippet: string | null,
  userClasses: ClassRow[]
): Candidate | null {
  const haystack = `${subject ?? ""}\n${bodySnippet ?? ""}`;
  const m = JA_SENSEI_RE.exec(haystack);
  if (!m) return null;
  const family = m[1];

  let firstHit: ClassRow | null = null;
  let hitCount = 0;
  for (const c of userClasses) {
    const prof = c.professor ?? "";
    if (!prof) continue;
    if (prof.includes(family)) {
      firstHit ??= c;
      hitCount++;
    }
  }
  if (!firstHit) return null;
  return {
    classId: firstHit.id,
    confidence: hitCount === 1 ? 0.8 : 0.55,
    method: "ja_sensei_pattern",
  };
}

async function matchVectorChunks(
  userId: string,
  queryEmbedding: number[]
): Promise<Candidate | null> {
  const vec = `[${queryEmbedding.join(",")}]`;

  // Pull top-K syllabus + mistake chunks together via a UNION ALL, joined
  // back to the parent (syllabi / mistake_notes) so we can read class_id
  // off the parent row. v1: sequential scan; pgvector index deferred per
  // §4.7.
  const rowsRes = await db.execute<{
    class_id: string | null;
    distance: number;
  }>(sql`
    SELECT
      class_id,
      distance
    FROM (
      SELECT
        s.class_id AS class_id,
        (sc.embedding <=> ${vec}::vector(1536)) AS distance
      FROM syllabus_chunks sc
      JOIN syllabi s ON s.id = sc.syllabus_id
      WHERE sc.user_id = ${userId}
        AND s.deleted_at IS NULL
        AND s.class_id IS NOT NULL
      ORDER BY sc.embedding <=> ${vec}::vector(1536)
      LIMIT ${VECTOR_TOP_K}
    ) AS s_top
    UNION ALL
    SELECT
      class_id,
      distance
    FROM (
      SELECT
        mn.class_id AS class_id,
        (mc.embedding <=> ${vec}::vector(1536)) AS distance
      FROM mistake_note_chunks mc
      JOIN mistake_notes mn ON mn.id = mc.mistake_id
      WHERE mc.user_id = ${userId}
        AND mn.deleted_at IS NULL
        AND mn.class_id IS NOT NULL
      ORDER BY mc.embedding <=> ${vec}::vector(1536)
      LIMIT ${VECTOR_TOP_K}
    ) AS m_top
  `);

  const rows = (rowsRes as unknown as {
    rows: Array<{ class_id: string | null; distance: number }>;
  }).rows ?? [];

  // Aggregate per class_id. Track the count above the similarity floor and
  // the maximum similarity (best chunk) for tie-breaking.
  type Bucket = { count: number; topSim: number };
  const buckets = new Map<string, Bucket>();
  let above = 0;
  for (const r of rows) {
    if (!r.class_id) continue;
    const sim = distanceToSimilarity(Number(r.distance));
    if (sim < VECTOR_MIN_SIM) continue;
    above++;
    const cur = buckets.get(r.class_id) ?? { count: 0, topSim: 0 };
    cur.count++;
    if (sim > cur.topSim) cur.topSim = sim;
    buckets.set(r.class_id, cur);
  }
  if (above === 0 || buckets.size === 0) return null;

  let bestId: string | null = null;
  let bestCount = 0;
  let bestTopSim = 0;
  for (const [id, b] of buckets.entries()) {
    if (
      b.count > bestCount ||
      (b.count === bestCount && b.topSim > bestTopSim)
    ) {
      bestId = id;
      bestCount = b.count;
      bestTopSim = b.topSim;
    }
  }
  if (!bestId) return null;

  const fraction = bestCount / Math.max(above, 1);
  if (fraction < DOMINANT_FRACTION) return null;

  // Confidence = blend of dominance fraction (how unanimous the top-K is)
  // and top similarity (how close the best chunk is). Capped at 0.8 so a
  // structured method can still outrank a strong vector hit.
  const confidence = Math.min(0.8, 0.5 * fraction + 0.5 * bestTopSim);
  return {
    classId: bestId,
    confidence,
    method: "vector_chunks",
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadUserClasses(userId: string): Promise<ClassRow[]> {
  return db
    .select({
      id: classes.id,
      name: classes.name,
      code: classes.code,
      professor: classes.professor,
    })
    .from(classes)
    .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)));
}

function bestOf(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const c of candidates.slice(1)) {
    if (c.confidence > best.confidence) best = c;
  }
  return best;
}

function finalize(
  winner: Candidate,
  candidates: Candidate[]
): ClassBindingResult {
  const alternates = candidates
    .filter(
      (c) => !(c.classId === winner.classId && c.method === winner.method)
    )
    .sort((a, b) => b.confidence - a.confidence);
  return {
    classId: winner.classId,
    confidence: winner.confidence,
    method: winner.method,
    alternates,
  };
}

function noneResult(): ClassBindingResult {
  return { classId: null, confidence: 0, method: "none", alternates: [] };
}

// Word-boundary substring match. Simple .includes is too lax (matches
// substrings of other tokens); a /\b<code>\b/i regex would work but
// constructing one per loop iteration is wasteful, and \b is ASCII-only
// in JS RegExp. We hand-roll a left-and-right boundary check that treats
// any non-alphanumeric character (or string boundary) as a boundary.
function matchesAsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return false;
    const left = idx === 0 ? "" : haystack.charAt(idx - 1);
    const right =
      idx + needle.length >= haystack.length
        ? ""
        : haystack.charAt(idx + needle.length);
    if (!isAlnum(left) && !isAlnum(right)) return true;
    from = idx + 1;
  }
}

function isAlnum(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) // a-z
  );
}

// Same conversion as lib/agent/email/retrieval.ts. Re-defined locally to
// avoid an import cycle with the retrieval module (which doesn't import
// this file today, but might once fanout lands).
function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance / 2;
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}
