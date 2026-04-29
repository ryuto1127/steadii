import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  events,
  syllabi,
  type ActionOption,
  type NewAgentProposalRow,
} from "@/lib/db/schema";
import { agentProposals } from "@/lib/db/schema";
import {
  CalendarNotConnectedError,
  getCalendarForUser,
} from "@/lib/integrations/google/calendar";
import {
  createMsEvent,
} from "@/lib/integrations/microsoft/calendar";
import { MsNotConnectedError } from "@/lib/integrations/microsoft/graph-client";
import { getConnectedCalendarProviders } from "@/lib/agent/tools/connected-providers";
import { upsertFromSourceRow } from "@/lib/calendar/events-store";
import { recordAutoActionLog } from "./notify";
import { buildDedupKey } from "./dedup";
import {
  FUZZY_TIME_WINDOW_HOURS,
  matchToCalendar,
  parseSimpleDate,
} from "./syllabus-match";

// D10 — syllabus → calendar auto-import with dedup + ambiguity proposal.
//
// Called as a background step right after `saveSyllabusToPostgres` lands.
// Walks the syllabus.schedule[] rows, classifies each row (lecture
// recurring / exam / deadline), looks for a candidate match in the
// user's existing Google Calendar, and per match outcome:
//
//   confident match → skip silently, log via recordAutoActionLog
//   confident no-match → add the event with a "[Steadii]" prefix
//   ambiguous → emit a syllabus_calendar_ambiguity proposal so the
//               user disambiguates with one click
//
// All three branches notify per D11. Auto-add events carry the
// originating syllabus row id in the description so the user can
// trace back.

const STEADII_PREFIX = "[Steadii]";
const EXAM_KEYWORDS =
  /\b(exam|midterm|final|quiz|試験|期末|中間|テスト)\b/i;

export type ExtractedSyllabusEvent = {
  syllabusRowKey: string; // ${syllabusId}:${index}
  classCode: string | null;
  className: string;
  startsAt: Date;
  endsAt: Date;
  label: string;
  isExam: boolean;
};

export type SyllabusImportResult = {
  added: number;
  skippedConfidentMatch: number;
  ambiguousProposed: number;
  errors: number;
};

export async function runSyllabusAutoImport(args: {
  userId: string;
  syllabusId: string;
}): Promise<SyllabusImportResult> {
  const result: SyllabusImportResult = {
    added: 0,
    skippedConfidentMatch: 0,
    ambiguousProposed: 0,
    errors: 0,
  };

  const [syl] = await db
    .select({
      id: syllabi.id,
      classId: syllabi.classId,
      title: syllabi.title,
      schedule: syllabi.schedule,
    })
    .from(syllabi)
    .where(
      and(eq(syllabi.id, args.syllabusId), eq(syllabi.userId, args.userId))
    )
    .limit(1);
  if (!syl || !syl.schedule) return result;

  const cls = syl.classId
    ? await db
        .select({
          id: classes.id,
          name: classes.name,
          code: classes.code,
        })
        .from(classes)
        .where(eq(classes.id, syl.classId))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  // Translate schedule[] into structured events with concrete dates.
  const extracted: ExtractedSyllabusEvent[] = [];
  for (let i = 0; i < syl.schedule.length; i++) {
    const item = syl.schedule[i];
    if (!item.date || !item.topic) continue;
    const start = parseSimpleDate(item.date);
    if (!start) continue;
    const isExam = EXAM_KEYWORDS.test(item.topic);
    extracted.push({
      syllabusRowKey: `${syl.id}:${i}`,
      classCode: cls?.code ?? null,
      className: cls?.name ?? syl.title,
      startsAt: start,
      endsAt: new Date(start.getTime() + 90 * 60 * 1000),
      label: item.topic,
      isExam,
    });
  }
  if (extracted.length === 0) return result;

  // Pull the user's calendar events covering the same window so we can
  // match. We only need the smallest range that contains the schedule's
  // dates ± fuzzy window.
  const allDates = extracted.map((e) => e.startsAt.getTime());
  const minDate = new Date(
    Math.min(...allDates) - FUZZY_TIME_WINDOW_HOURS * 3600 * 1000
  );
  const maxDate = new Date(
    Math.max(...allDates) + FUZZY_TIME_WINDOW_HOURS * 3600 * 1000
  );
  // Dedup against BOTH Google Calendar and Microsoft Calendar — a syllabus
  // event already on either upstream shouldn't be re-added. iCal-subscription
  // events are read-only and intentionally excluded (the user's own syllabus
  // shouldn't dedup against an externally subscribed feed).
  const calendarRows = await db
    .select({
      id: events.id,
      externalId: events.externalId,
      title: events.title,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, args.userId),
        inArray(events.sourceType, ["google_calendar", "microsoft_graph"])
      )
    );
  const inWindow = calendarRows.filter(
    (r) => r.startsAt >= minDate && r.startsAt <= maxDate
  );

  for (const evt of extracted) {
    try {
      const outcome = matchToCalendar(evt, inWindow);
      if (outcome.kind === "confident_match") {
        result.skippedConfidentMatch++;
        continue;
      }
      if (outcome.kind === "ambiguous") {
        const ok = await proposeAmbiguity({
          userId: args.userId,
          syllabusId: syl.id,
          extracted: evt,
          candidate: outcome.candidate,
        });
        if (ok) result.ambiguousProposed++;
        continue;
      }
      // confident_no_match → auto-add to Google Calendar
      const created = await createAndMirror({
        userId: args.userId,
        syllabusId: syl.id,
        extracted: evt,
      });
      if (created) result.added++;
    } catch (err) {
      result.errors++;
      Sentry.captureException(err, {
        tags: {
          feature: "syllabus_auto_import",
          syllabusId: args.syllabusId,
          rowKey: evt.syllabusRowKey,
        },
      });
    }
  }

  // D11 — single summary log so the user sees what happened.
  if (result.added > 0 || result.skippedConfidentMatch > 0) {
    await recordAutoActionLog({
      userId: args.userId,
      summary: buildSummary(syl.title, result),
      reasoning: buildSummaryReasoning(syl.title, result),
      sourceRefs: [{ kind: "syllabus", id: syl.id, label: syl.title }],
      dedupRecordIds: [`syllabus_import:${syl.id}`],
    }).catch(() => {});
  }

  return result;
}

async function createAndMirror(args: {
  userId: string;
  syllabusId: string;
  extracted: ExtractedSyllabusEvent;
}): Promise<boolean> {
  const evt = args.extracted;
  const title = `${STEADII_PREFIX} ${evt.classCode ? evt.classCode + " " : ""}${evt.label}`.trim();
  const description = `Imported from Steadii syllabus ${args.syllabusId}.`;
  const providers = await getConnectedCalendarProviders(args.userId);

  // No calendar provider connected — the auto-import has nothing to write
  // to. The proactive layer will still record the no-op via the summary
  // log; surfaced as `errors: 0, added: 0` from the caller's perspective.
  if (providers.length === 0) return false;

  let createdAny = false;

  for (const target of providers) {
    if (target === "google") {
      try {
        const cal = await getCalendarForUser(args.userId);
        const resp = await cal.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: title,
            description,
            start: { dateTime: evt.startsAt.toISOString() },
            end: { dateTime: evt.endsAt.toISOString() },
          },
        });
        if (resp.data.id) {
          await upsertFromSourceRow({
            userId: args.userId,
            sourceType: "google_calendar",
            sourceAccountId: "primary",
            externalId: resp.data.id,
            title,
            description,
            startsAt: evt.startsAt,
            endsAt: evt.endsAt,
            isAllDay: false,
            kind: "event",
            status: "confirmed",
            sourceMetadata: {
              source: "syllabus_auto_import",
              syllabusId: args.syllabusId,
            },
          });
          createdAny = true;
        }
      } catch (err) {
        if (err instanceof CalendarNotConnectedError) {
          // Defensive: the providers list said Google was connected but the
          // helper disagrees. Skip silently — the dual-write is best-effort.
        } else {
          throw err;
        }
      }
    } else if (target === "microsoft-entra-id") {
      try {
        // createMsEvent already mirrors into the events table via
        // writeThroughMsEvent — no manual upsert here.
        await createMsEvent({
          userId: args.userId,
          summary: title,
          description,
          start: evt.startsAt.toISOString(),
          end: evt.endsAt.toISOString(),
        });
        createdAny = true;
      } catch (err) {
        if (err instanceof MsNotConnectedError) {
          // User hadn't re-consented to ReadWrite yet — skip silently. The
          // legacy Read-only scope still lets reads through, but writes
          // need the wider scope.
        } else {
          // Don't fail the whole import on one upstream's hiccup — log to
          // Sentry via the caller's catch and let Google succeed.
          throw err;
        }
      }
    }
  }

  return createdAny;
}

async function proposeAmbiguity(args: {
  userId: string;
  syllabusId: string;
  extracted: ExtractedSyllabusEvent;
  candidate: { id: string; title: string };
}): Promise<boolean> {
  const evt = args.extracted;
  const summary = `${evt.label} (${evt.startsAt
    .toISOString()
    .slice(0, 16)
    .replace("T", " ")}) — 既存の「${args.candidate.title}」と同じですか?`;
  const reasoning = `Syllabus row "${evt.label}" lands at ${evt.startsAt
    .toISOString()
    .slice(0, 16)
    .replace("T", " ")}. Existing calendar event "${args.candidate.title}" is within ±1 hour. Confirm whether they're the same event before Steadii imports.`;
  const actionOptions: ActionOption[] = [
    {
      key: "link_existing",
      label: "✓ 同じ — link to existing",
      description: "Mark these as the same event; nothing is added.",
      tool: "link_existing",
      payload: {
        existingEventId: args.candidate.id,
        syllabusRowKey: evt.syllabusRowKey,
      },
    },
    {
      key: "add_anyway",
      label: "+ 別 event として追加",
      description: "Add the syllabus event despite the calendar match.",
      tool: "add_anyway",
      payload: {
        syllabusId: args.syllabusId,
        syllabusRowKey: evt.syllabusRowKey,
      },
    },
    {
      key: "dismiss",
      label: "× 後で",
      description: "Skip for now. Hide for 24 hours.",
      tool: "dismiss",
      payload: {},
    },
  ];
  const dedupKey = buildDedupKey("syllabus_calendar_ambiguity", [
    evt.syllabusRowKey,
    args.candidate.id,
  ]);
  const row: NewAgentProposalRow = {
    userId: args.userId,
    issueType: "syllabus_calendar_ambiguity",
    issueSummary: summary,
    reasoning,
    sourceRefs: [
      {
        kind: "syllabus_event",
        id: evt.syllabusRowKey,
        label: evt.label,
      },
      {
        kind: "calendar_event",
        id: args.candidate.id,
        label: args.candidate.title,
      },
    ],
    actionOptions,
    dedupKey,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
  const inserted = await db
    .insert(agentProposals)
    .values(row)
    .onConflictDoNothing({
      target: [agentProposals.userId, agentProposals.dedupKey],
    })
    .returning({ id: agentProposals.id });
  return inserted.length > 0;
}

function buildSummary(syllabusTitle: string, r: SyllabusImportResult): string {
  const ja = `${syllabusTitle} シラバスから ${r.added} 件追加、${r.ambiguousProposed} 件は確認のため保留中です。`;
  return ja;
}

function buildSummaryReasoning(
  syllabusTitle: string,
  r: SyllabusImportResult
): string {
  return [
    `Steadii ran the syllabus auto-import for "${syllabusTitle}":`,
    `  • added ${r.added} events to the user's connected calendars (Google + Microsoft when both linked)`,
    `  • skipped ${r.skippedConfidentMatch} that already existed`,
    `  • surfaced ${r.ambiguousProposed} ambiguous matches for confirmation`,
    `  • errors: ${r.errors}`,
  ].join("\n");
}

