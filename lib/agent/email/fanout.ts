import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentContactPersonas,
  agentDrafts,
  assignments,
  classes,
  emailEmbeddings,
  inboxItems,
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
import { fetchMsUpcomingEvents } from "@/lib/integrations/microsoft/calendar";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import { fetchUpcomingIcalEvents } from "@/lib/integrations/ical/queries";
import { logEmailAudit } from "./audit";
import {
  searchSimilarEmails,
  type SimilarEmail,
} from "./retrieval";
import { fetchSentMessagesToRecipient } from "@/lib/integrations/google/gmail-fetch";
import {
  findSimilarSentEmails,
  type SimilarSentEmail,
} from "./similar-sent-retrieval";
import { rerank, type RerankerCandidate } from "./reranker";

// Per-source caps locked in §12.2 (per-source caps, not a single total
// budget). k_syllabus=3, k_emails=5 (classify) / 20 (deep).
// engineer-38 — k_sender_history=3 (top-3 most-recent past replies to the
// same sender). Replaces the dead mistakes slot (PR #182).
export const FANOUT_K_SYLLABUS = 3;
export const FANOUT_K_EMAILS_CLASSIFY = 5;
export const FANOUT_K_EMAILS_DEEP = 20;
export const FANOUT_K_SENDER_HISTORY = 3;
// engineer-48 — second-pass reranker tightens the deep-phase email
// slate from cosine top-20 down to the most directly-relevant 8. The
// classify phase already pulls a tighter 5; no rerank needed there.
// Skip the rerank entirely when the cosine slate is small enough that
// the LLM call's overhead outweighs the precision lift.
export const FANOUT_K_EMAILS_RERANKED = 8;
const RERANK_MIN_CANDIDATES = 5;
// 2026-05-08 — k_similar_sent=3. Concrete few-shot examples of past
// replies on similar topics (different recipients than sender-history's
// same-recipient slate). Draft-phase only.
export const FANOUT_K_SIMILAR_SENT = 3;

// Calendar windows. §12.10 locked decision: live both classify and draft.
export const FANOUT_CALENDAR_DAYS_CLASSIFY = 3;
export const FANOUT_CALENDAR_DAYS_DRAFT = 7;
export const FANOUT_CALENDAR_MAX_CLASSIFY = 8;
export const FANOUT_CALENDAR_MAX_DRAFT = 25;

// Per-source similarity floors. Engineer-35 (2026-05-06) split the single
// 0.55 floor into class-bound vs class-unbound after a recruiting email
// surfaced syllabus-1 64% in the draft details panel — at 0.55 the unbound
// vector search was catching topical-overlap chunks for emails that have
// nothing to do with any class. Keep the bound floor lenient (the email
// is already known-academic via the binding); raise the unbound floor so
// only strong semantic matches survive when there's no class anchor.
const SYLLABUS_SIM_FLOOR_BOUND = 0.55;
const SYLLABUS_SIM_FLOOR_UNBOUND = 0.78;

// Engineer-35 — when an email is structurally non-academic (recruiting,
// billing, OTP, vendor support) AND lacks a class binding, vector search
// at any threshold is too lossy. We bypass syllabus + vector-mistakes
// retrieval entirely for these emails. The predicate is keyword-based on
// (subject + snippet); false-positives intentionally pass through (better
// to over-retrieve than miss a real class email). Tuned via the
// fanout-quality-audit regression suite.
const EMAIL_LIKELY_ACADEMIC_KEYWORDS_EN = [
  "syllabus",
  "syllabi",
  "assignment",
  "assignments",
  "homework",
  "midterm",
  "midterms",
  "final exam",
  "finals",
  "lecture",
  "lectures",
  "professor",
  "professors",
  "TA",
  "TAs",
  "office hour",
  "office hours",
  "class",
  "classes",
  "course",
  "courses",
  "quiz",
  "quizzes",
  "textbook",
  "textbooks",
  "problem set",
  "problem sets",
];

const EMAIL_LIKELY_ACADEMIC_KEYWORDS_JA = [
  "シラバス",
  "課題",
  "宿題",
  "中間",
  "期末",
  "試験",
  "講義",
  "教授",
  "先生",
  "オフィスアワー",
  "授業",
  "履修",
  "レポート",
  "提出",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// English keywords use \b boundaries so "TA" doesn't match "Toyota" /
// "data", "class" doesn't match "classify", etc. Japanese has no word
// boundaries so we substring-match — the JA keywords here are kanji
// compounds with low collision risk in non-academic Japanese text.
const ACADEMIC_EN_REGEX = new RegExp(
  `\\b(?:${EMAIL_LIKELY_ACADEMIC_KEYWORDS_EN.map(escapeRegExp).join("|")})\\b`,
  "i"
);

export function isEmailLikelyAcademic(
  subject: string | null,
  snippet: string | null
): boolean {
  const text = `${subject ?? ""}\n${snippet ?? ""}`;
  if (!text.trim()) return false;
  if (ACADEMIC_EN_REGEX.test(text)) return true;
  for (const kw of EMAIL_LIKELY_ACADEMIC_KEYWORDS_JA) {
    if (text.includes(kw)) return true;
  }
  return false;
}

// Per-source timeout. §4.6: calendar tolerates 100-500ms; structured/vector
// branches finish under 50ms but are wrapped for safety.
const SOURCE_TIMEOUT_MS = 500;

export type FanoutPhase = "classify" | "deep" | "draft";

// engineer-38 — past sent replies from the user to this same sender.
// Newest-first, capped at FANOUT_K_SENDER_HISTORY. Carries the original
// inbox subject/snippet so the prompt can show "what they wrote in
// response to" alongside the reply itself.
//
// 2026-05-08 — `source` field added so the merged sender-history can
// include both Steadii-mediated sends (`agent_drafts.status='sent'`) and
// Gmail-direct replies fetched via the Gmail API. Direct-Gmail replies
// don't have an `originalSubject`/`Snippet` because their incoming
// counterpart isn't necessarily in `inbox_items` (a Steadii-classified
// thread may have replies from before Steadii was connected, or to
// senders Steadii's L1 didn't classify). The prompt renders both
// uniformly via the existing `self-N` slot.
export type FanoutSenderHistory = {
  draftId: string;
  draftSubject: string | null;
  draftBody: string | null;
  sentAt: Date;
  originalSubject: string | null;
  originalSnippet: string | null;
  source: "steadii" | "gmail_direct";
};

// engineer-39 — per-(user, contact) persona block. Populated by the
// persona-learner cron and surfaced in draft / classify / deep prompts
// as the "Contact persona" block. Null when no row exists yet (first
// interaction, fresh contact). The relationship label appears in the
// block header; facts render as a bullet list.
export type FanoutContactPersona = {
  relationship: string | null;
  facts: string[];
  lastExtractedAt: Date | null;
};

export type FanoutSyllabusChunk = {
  chunkId: string;
  syllabusId: string;
  classId: string | null;
  syllabusTitle: string;
  chunkText: string;
  similarity: number;
};

export type FanoutSteadiiAssignment = {
  id: string;
  classId: string | null;
  className: string | null;
  title: string;
  due: string; // YYYY-MM-DD
  status: "not_started" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | null;
};

export type FanoutCalendar = {
  events: DraftCalendarEvent[];
  tasks: DraftCalendarTask[];
  // Phase 7 W1 — Steadii's own assignments due in the fanout window.
  // Surfaced alongside Google events + Google Tasks in a single calendar
  // block so the L2 prompts see the user's full upcoming commitments.
  assignments: FanoutSteadiiAssignment[];
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
  // engineer-38 — replaces the empty `mistakes` slot from PR #182. The
  // sender-history source carries the user's prior replies to the same
  // sender, which is the strongest tone/register signal we have.
  senderHistory: FanoutSenderHistory[];
  // 2026-05-08 — past sent emails on similar topics (different
  // recipients than `senderHistory`'s same-recipient slate). Fills the
  // gap between voice profile (global summary) and sender history
  // (per-recipient): "first-time recipient but Ryuto has written lots
  // of similar-context emails before." Populated only on the draft
  // phase; classify + deep phases get an empty list to keep the hot
  // path quota-cheap.
  similarSent: SimilarSentEmail[];
  // engineer-39 — LLM-distilled persona for the inbox row's sender.
  // Null when no agent_contact_personas row exists yet for this
  // (user, contact_email) pair. Cheap DB lookup so populated for all
  // phases.
  contactPersona: FanoutContactPersona | null;
  syllabusChunks: FanoutSyllabusChunk[];
  similarEmails: SimilarEmail[];
  totalSimilarCandidates: number;
  calendar: FanoutCalendar;
  // Per-source timing in ms — surfaced in audit logs + admin metrics.
  // `senderHistory` replaces the prior `mistakes` timing slot. The other
  // sources keep their names so existing dashboards stay readable.
  timings: {
    senderHistory: number;
    similarSent: number;
    contactPersona: number;
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
  // engineer-38 — sender email is the join key for sender-history. The
  // L2 pipeline always has it on the inbox row; threading it through
  // here saves a redundant inboxItems re-fetch inside fanout.
  senderEmail: string | null;
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
  // Soft-deleted classes must not surface in agent provenance — when the
  // user deletes a class, fanout should treat it as if no class binding
  // exists rather than ghost the deleted name into the reasoning panel.
  let className: string | null = null;
  let classCode: string | null = null;
  if (classId) {
    const [c] = await db
      .select({ name: classes.name, code: classes.code })
      .from(classes)
      .where(and(eq(classes.id, classId), isNull(classes.deletedAt)))
      .limit(1);
    className = c?.name ?? null;
    classCode = c?.code ?? null;
  }

  // Engineer-35 — derived gates for non-academic / class-unbound emails.
  // `isClassBound` keys off the binder's verdict (any method other than
  // "none" means the L1 binding heuristic decided this email belongs to a
  // class). `shouldGateNonAcademic` short-circuits syllabus + vector
  // mistakes when the email is both unbound AND lacks academic keywords.
  const isClassBound = method !== "none";
  const isAcademic = isEmailLikelyAcademic(input.subject, input.snippet);
  const shouldGateNonAcademic = !isClassBound && !isAcademic;

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
  //
  // engineer-38 — replaced the dead mistakes slot (PR #182, secretary
  // pivot) with sender-history. The user's past replies to the same
  // sender are the strongest tone/register signal: vector retrieval
  // never reaches for them and they're the moment Steadii's drafts
  // start sounding like the user wrote them rather than a template.
  const [
    senderHistory,
    similarSent,
    contactPersona,
    syllabusChunks,
    emails,
    calendar,
  ] = await Promise.all([
    timed(
      "senderHistory",
      async () => {
        if (!input.senderEmail) return [];
        return loadSenderHistory(
          input.userId,
          input.senderEmail,
          FANOUT_K_SENDER_HISTORY
        );
      },
      timeouts
    ),
    timed(
      "similarSent",
      async () => {
        // Draft-phase only — concrete few-shot examples for style
        // transfer. The classify + deep phases decide actions, not
        // tone, so the Gmail call would be wasted quota there.
        if (input.phase !== "draft") return [] as SimilarSentEmail[];
        return findSimilarSentEmails({
          userId: input.userId,
          subject: input.subject,
          snippet: input.snippet,
          excludeRecipientEmail: input.senderEmail,
          k: FANOUT_K_SIMILAR_SENT,
        });
      },
      timeouts
    ),
    timed(
      "contactPersona",
      async () => {
        // engineer-39 — single-row lookup keyed on (userId, senderEmail).
        // Cheap DB read; populated across all phases. Null when the
        // persona-learner cron hasn't extracted a row yet.
        if (!input.senderEmail)
          return null as FanoutContactPersona | null;
        return loadContactPersona(input.userId, input.senderEmail);
      },
      timeouts
    ),
    timed("syllabus", async () => {
      if (!queryEmbedding) {
        // No embedding → can't rank; skip.
        return [];
      }
      // Engineer-35 — same gate. Vector similarity at any threshold is
      // too lossy when the email is structurally non-academic.
      if (shouldGateNonAcademic) return [];
      const floor = isClassBound
        ? SYLLABUS_SIM_FLOOR_BOUND
        : SYLLABUS_SIM_FLOOR_UNBOUND;
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
      return rows.filter((r) => r.similarity >= floor);
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
        // Five flavors per Phase 7 W-Integrations: Google events + Google
        // Tasks + MS Outlook events + MS To Do tasks + iCal-subscribed
        // events, all merged into Steadii's own assignments. Single
        // retrieval pipeline; the prompt renders the union as one calendar
        // block. Per-source soft-fail keeps a missing connection from
        // taking the whole block down.
        const [
          gEvents,
          gTasks,
          msEvents,
          msTasks,
          icalEvents,
          steadiiAssignments,
        ] = await Promise.all([
          safelyFetchEvents(input.userId, calendarDays, calendarMax),
          safelyFetchTasks(input.userId, calendarDays, calendarMax),
          safelyFetchMsEvents(input.userId, calendarDays, calendarMax),
          safelyFetchMsTasks(input.userId, calendarDays, calendarMax),
          safelyFetchIcalEvents(input.userId, calendarDays, calendarMax),
          safelyFetchSteadiiAssignments(
            input.userId,
            calendarDays,
            calendarMax
          ),
        ]);
        // Cap the merged event list at calendarMax so a user with both
        // Google and MS connected can't blow past the prompt budget.
        const events = [...gEvents, ...msEvents, ...icalEvents]
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, calendarMax);
        const tasks = [...gTasks, ...msTasks]
          .sort((a, b) => a.due.localeCompare(b.due))
          .slice(0, calendarMax);
        return { events, tasks, assignments: steadiiAssignments };
      },
      timeouts
    ),
  ]);

  // engineer-48 — second-pass reranker. Only runs on the deep phase
  // (cosine slate is top-20 there; classify already pulls top-5 so the
  // overhead wouldn't pay back). Tightens similar-emails to top-8 and
  // syllabusChunks when cardinality clears the LLM-call threshold.
  // Fail-soft: a reranker error returns the candidates unchanged so
  // the L2 pipeline never blocks on this added step.
  let rerankedSimilarEmails = emails.value.results;
  let syllabusChunksRanked = syllabusChunks.value;
  let rerankAudit: {
    similarEmails: { before: number; after: number; failed: boolean } | null;
    syllabusChunks: { before: number; after: number; failed: boolean } | null;
  } = { similarEmails: null, syllabusChunks: null };
  if (input.phase === "deep" && emails.value.results.length >= RERANK_MIN_CANDIDATES) {
    const queryForRerank = `${input.subject ?? ""}\n${input.snippet ?? ""}`.trim();
    const candidates: RerankerCandidate[] = emails.value.results.map((r) => ({
      id: r.inboxItemId,
      text: `${r.subject ?? ""}\n${r.snippet ?? ""}`.trim() || "(empty)",
      sourceType: "similar_email",
    }));
    const out = await rerank({
      userId: input.userId,
      query: queryForRerank,
      candidates,
      topK: FANOUT_K_EMAILS_RERANKED,
    });
    const orderById = new Map(out.ranked.map((r, i) => [r.id, i]));
    rerankedSimilarEmails = emails.value.results
      .filter((r) => orderById.has(r.inboxItemId))
      .sort(
        (a, b) =>
          (orderById.get(a.inboxItemId) ?? 0) -
          (orderById.get(b.inboxItemId) ?? 0)
      );
    rerankAudit.similarEmails = {
      before: out.beforeCount,
      after: rerankedSimilarEmails.length,
      failed: out.failed,
    };
  }
  if (
    input.phase === "deep" &&
    syllabusChunks.value.length >= RERANK_MIN_CANDIDATES
  ) {
    const queryForRerank = `${input.subject ?? ""}\n${input.snippet ?? ""}`.trim();
    const candidates: RerankerCandidate[] = syllabusChunks.value.map((c) => ({
      id: c.chunkId,
      text: `${c.syllabusTitle}: ${c.chunkText}`,
      sourceType: "syllabus_chunk",
    }));
    const out = await rerank({
      userId: input.userId,
      query: queryForRerank,
      candidates,
      topK: FANOUT_K_SYLLABUS,
    });
    const orderById = new Map(out.ranked.map((r, i) => [r.id, i]));
    syllabusChunksRanked = syllabusChunks.value
      .filter((c) => orderById.has(c.chunkId))
      .sort(
        (a, b) =>
          (orderById.get(a.chunkId) ?? 0) - (orderById.get(b.chunkId) ?? 0)
      );
    rerankAudit.syllabusChunks = {
      before: out.beforeCount,
      after: syllabusChunksRanked.length,
      failed: out.failed,
    };
  }
  // One audit row per rerank pass so the activity log can prove the
  // precision lift end-to-end.
  if (rerankAudit.similarEmails || rerankAudit.syllabusChunks) {
    await logEmailAudit({
      userId: input.userId,
      action: "retrieval_reranked",
      result:
        (rerankAudit.similarEmails?.failed || rerankAudit.syllabusChunks?.failed)
          ? "failure"
          : "success",
      resourceId: input.inboxItemId,
      detail: {
        phase: input.phase,
        similar_emails: rerankAudit.similarEmails,
        syllabus_chunks: rerankAudit.syllabusChunks,
      },
    });
  }

  const total = Date.now() - startedAt;

  // Audit row — joinable to email_l2_completed by resourceId. The detail
  // payload powers per-source latency / citation rate dashboards (PR 5).
  const detail = {
    phase: input.phase,
    classBinding: { classId, method, confidence },
    // Engineer-35 — surface the gate decision so admin metrics can chart
    // how many ingest cycles short-circuit syllabus/mistakes retrieval.
    academic_gate: {
      isClassBound,
      isAcademic,
      shouldGateNonAcademic,
    },
    counts: {
      senderHistory: senderHistory.value.length,
      similarSent: similarSent.value.length,
      // engineer-39 — 1 = persona row hit, 0 = first interaction.
      contactPersona: contactPersona.value ? 1 : 0,
      syllabus: syllabusChunksRanked.length,
      emails: rerankedSimilarEmails.length,
      calendar:
        calendar.value.events.length +
        calendar.value.tasks.length +
        calendar.value.assignments.length,
    },
    rerank: rerankAudit,
    timings_ms: {
      senderHistory: senderHistory.elapsed,
      similarSent: similarSent.elapsed,
      contactPersona: contactPersona.elapsed,
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
    senderHistory: senderHistory.value,
    similarSent: similarSent.value,
    contactPersona: contactPersona.value,
    syllabusChunks: syllabusChunksRanked,
    similarEmails: rerankedSimilarEmails,
    totalSimilarCandidates: emails.value.totalCandidates,
    calendar: calendar.value,
    timings: {
      senderHistory: senderHistory.elapsed,
      similarSent: similarSent.elapsed,
      contactPersona: contactPersona.elapsed,
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

// engineer-38 — top-k most-recent past replies the user has SENT to this
// same sender, joined through inbox_items so we can match on the
// inbox row's senderEmail (agent_drafts doesn't denormalize it).
// `status='sent'` + `sentAt IS NOT NULL` are belt-and-suspenders — both
// hold today but together make the ordering deterministic even if the
// status enum drifts later.
//
// 2026-05-08 — fuses Steadii-mediated sends with the user's direct-Gmail
// replies to the same recipient, deduped by gmail message id. Direct
// replies (Ryuto bypassed Steadii) carried zero per-sender signal before
// this; voice profile only summarizes globally. Gmail fetch is fail-soft
// so a Gmail outage degrades to the Steadii-only behavior.
export async function loadSenderHistory(
  userId: string,
  senderEmail: string,
  k: number
): Promise<FanoutSenderHistory[]> {
  // Pull a wider Gmail window than `k` so dedup against Steadii-sent
  // rows still leaves enough headroom to fill the slate. K is small
  // (3 by default), so the +5 buffer keeps the Gmail call bounded.
  const GMAIL_OVERFETCH = 5;

  const [steadiiRaw, gmailDirectRaw] = await Promise.all([
    loadSenderHistorySteadii(userId, senderEmail, k),
    fetchSentMessagesToRecipient(userId, senderEmail, k + GMAIL_OVERFETCH).catch(
      (err) => {
        Sentry.captureException(err, {
          level: "warning",
          tags: { feature: "email_fanout", source: "sender_history_gmail" },
          user: { id: userId },
        });
        return [] as Awaited<
          ReturnType<typeof fetchSentMessagesToRecipient>
        >;
      }
    ),
  ]);

  const steadii: FanoutSenderHistory[] = steadiiRaw.map((r) => ({
    draftId: r.draftId,
    draftSubject: r.draftSubject,
    draftBody: r.draftBody,
    sentAt: r.sentAt,
    originalSubject: r.originalSubject,
    originalSnippet: r.originalSnippet,
    source: "steadii" as const,
  }));

  // Dedup: any Gmail message whose id matches a Steadii-sent
  // gmail_sent_message_id is the SAME physical send. Drop the duplicate
  // (Steadii path wins because it carries originalSubject/Snippet too).
  const steadiiGmailIds = new Set(
    steadiiRaw
      .map((r) => r.gmailSentMessageId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const gmailDirect: FanoutSenderHistory[] = gmailDirectRaw
    .filter((g) => !steadiiGmailIds.has(g.messageId))
    .map((g) => ({
      draftId: `gmail:${g.messageId}`,
      draftSubject: g.subject,
      draftBody: g.body,
      sentAt: g.sentAt,
      originalSubject: null,
      originalSnippet: null,
      source: "gmail_direct" as const,
    }));

  const merged = [...steadii, ...gmailDirect];
  merged.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  return merged.slice(0, k);
}

// Internal — Steadii-only path. Selects gmail_sent_message_id alongside
// the displayed fields so the merge step can dedup against Gmail-direct
// hits. Returning the raw shape (with the message-id) instead of the
// public FanoutSenderHistory keeps the dedup wholly inside loadSenderHistory.
async function loadSenderHistorySteadii(
  userId: string,
  senderEmail: string,
  k: number
): Promise<
  Array<{
    draftId: string;
    draftSubject: string | null;
    draftBody: string | null;
    sentAt: Date;
    originalSubject: string | null;
    originalSnippet: string | null;
    gmailSentMessageId: string | null;
  }>
> {
  const rows = await db
    .select({
      draftId: agentDrafts.id,
      draftSubject: agentDrafts.draftSubject,
      draftBody: agentDrafts.draftBody,
      sentAt: agentDrafts.sentAt,
      originalSubject: inboxItems.subject,
      originalSnippet: inboxItems.snippet,
      gmailSentMessageId: agentDrafts.gmailSentMessageId,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "sent"),
        isNotNull(agentDrafts.sentAt),
        eq(inboxItems.senderEmail, senderEmail)
      )
    )
    .orderBy(desc(agentDrafts.sentAt))
    .limit(k);
  return rows
    .filter((r): r is typeof r & { sentAt: Date } => r.sentAt instanceof Date)
    .map((r) => ({
      draftId: r.draftId,
      draftSubject: r.draftSubject,
      draftBody: r.draftBody,
      sentAt: r.sentAt,
      originalSubject: r.originalSubject,
      originalSnippet: r.originalSnippet,
      gmailSentMessageId: r.gmailSentMessageId,
    }));
}

// engineer-39 — single-row persona lookup keyed on (userId, contactEmail).
// Returns null when no row exists yet (first interaction with this
// contact, or persona-learner hasn't run yet for this user).
export async function loadContactPersona(
  userId: string,
  contactEmail: string
): Promise<FanoutContactPersona | null> {
  const [row] = await db
    .select({
      relationship: agentContactPersonas.relationship,
      facts: agentContactPersonas.facts,
      lastExtractedAt: agentContactPersonas.lastExtractedAt,
    })
    .from(agentContactPersonas)
    .where(
      and(
        eq(agentContactPersonas.userId, userId),
        eq(agentContactPersonas.contactEmail, contactEmail)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    relationship: row.relationship,
    facts: Array.isArray(row.facts) ? row.facts : [],
    lastExtractedAt: row.lastExtractedAt ?? null,
  };
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

async function safelyFetchMsEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchMsUpcomingEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ms_calendar_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchMsTasks(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarTask[]> {
  try {
    return await fetchMsUpcomingTasks(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ms_calendar_tasks" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchIcalEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchUpcomingIcalEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ical_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchSteadiiAssignments(
  userId: string,
  days: number,
  max: number
): Promise<FanoutSteadiiAssignment[]> {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        dueAt: assignments.dueAt,
        status: assignments.status,
        priority: assignments.priority,
        classId: assignments.classId,
        className: classes.name,
      })
      .from(assignments)
      .leftJoin(
        classes,
        and(eq(classes.id, assignments.classId), isNull(classes.deletedAt))
      )
      .where(
        and(
          eq(assignments.userId, userId),
          isNull(assignments.deletedAt),
          gte(assignments.dueAt, now),
          lt(assignments.dueAt, end)
        )
      )
      .limit(max);
    return rows
      .filter((r): r is typeof r & { dueAt: Date } => r.dueAt instanceof Date)
      .map((r) => ({
        id: r.id,
        classId: r.classId,
        className: r.className,
        title: r.title,
        due: r.dueAt.toISOString().slice(0, 10),
        status: r.status,
        priority: r.priority,
      }))
      .sort((a, b) => a.due.localeCompare(b.due));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_steadii" },
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
    case "senderHistory":
      return [] as FanoutSenderHistory[];
    case "similarSent":
      return [] as SimilarSentEmail[];
    case "contactPersona":
      return null as FanoutContactPersona | null;
    case "syllabus":
      return [] as FanoutSyllabusChunk[];
    case "emails":
      return { results: [] as SimilarEmail[], totalCandidates: 0 };
    case "calendar":
      return {
        events: [] as DraftCalendarEvent[],
        tasks: [] as DraftCalendarTask[],
        assignments: [] as FanoutSteadiiAssignment[],
      };
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
