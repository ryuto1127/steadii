import "server-only";
// Type-only import keeps the pure renderers below free of the DB/calendar
// import graph that lib/dashboard/today.ts pulls in (lib/db/client validates
// env at import time). The value loaders are dynamically imported inside
// loadTodaySection, the only function that actually needs them.
import type {
  DigestTodayEvent,
  DigestDueAssignment,
} from "@/lib/dashboard/today";
import type { DigestLocale } from "./build";

// ---------------------------------------------------------------------------
// Deterministic, zero-LLM "Today" section for the daily email digest.
//
// This is the marketing-centerpiece "morning briefing" surface: today's
// calendar events (time + title) and tasks/assignments due today or overdue,
// rendered from pure data + template. No LLM calls anywhere on this path.
//
// Timezone correctness is the whole game here: "today" is the user's local
// day (the digest is delivered per-user at 7am local), so an event at 23:30
// local yesterday must NOT appear (WRONG_TZ_DIRECTION). The loaders
// (lib/dashboard/today.ts) take the user's IANA tz; the time strings below
// are formatted in that same tz.
//
// EN/JA parity: both locales share the same data + ordering; only the
// surface copy differs. JA lines are kept short and naturally broken (no
// run-on paragraphs), consistent with the existing digest's JA register.
// ---------------------------------------------------------------------------

export type TodaySectionData = {
  events: DigestTodayEvent[];
  assignments: DigestDueAssignment[];
};

export type RenderedTodaySection = {
  text: string;
  html: string;
  // True when there's at least one event or due item. When false the
  // renderer still emits a single calm line (never an empty header).
  hasContent: boolean;
};

// Format an ISO instant as HH:MM in the user's tz (24h, matching the rest
// of the app's time presentation).
export function formatEventTime(iso: string, tz: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

function heading(locale: DigestLocale): string {
  return locale === "ja" ? "今日の予定" : "Today";
}

function eventsLabel(locale: DigestLocale): string {
  return locale === "ja" ? "予定" : "Schedule";
}

function dueLabel(locale: DigestLocale): string {
  return locale === "ja" ? "締切" : "Due";
}

function allDayLabel(locale: DigestLocale): string {
  return locale === "ja" ? "終日" : "All day";
}

function overdueLabel(locale: DigestLocale): string {
  return locale === "ja" ? "期限超過" : "Overdue";
}

function dueTodayLabel(locale: DigestLocale): string {
  return locale === "ja" ? "本日締切" : "Due today";
}

// 2026-06-13 — the digest "Today" section is now FORWARD-ONLY (today +
// BRIEFING_FORWARD_DAYS). A due item is therefore either due TODAY or due
// on an upcoming day in the window — never overdue. Pick the tag per item:
//   - overdue flag set (direct-render callers / legacy) → Overdue
//   - due on the user's local TODAY → Due today
//   - due on a future day in the window → "Due M/D" (locale-aware prefix)
// `tz` makes "today" the user's local day, not UTC; `now` is injectable so
// the renderer stays pure/deterministic (tests pass a fixed reference).
function dueTagForAssignment(
  a: DigestDueAssignment,
  tz: string,
  locale: DigestLocale,
  now: Date
): string {
  if (a.overdue) return overdueLabel(locale);
  if (!a.due) return dueTodayLabel(locale);
  const todayLocal = localDateStr(now.toISOString(), tz);
  const dueLocal = localDateStr(a.due, tz);
  if (dueLocal === todayLocal) return dueTodayLabel(locale);
  // Future-but-forward: render "Due M/D" so a day+2 deadline isn't
  // mislabeled "Due today".
  const [, mm, dd] = dueLocal.split("-");
  const md = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
  return `${dueLabel(locale)} ${md}`;
}

// "YYYY-MM-DD" for an ISO instant in the given tz.
function localDateStr(iso: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return iso.slice(0, 10);
  }
}

// Calm single line when the day is clear. Follows the existing digest's
// reassuring tone rather than rendering an empty header.
function emptyLine(locale: DigestLocale): string {
  return locale === "ja"
    ? "今日の予定と締切はありません。よい一日を。"
    : "No events or deadlines today. Have a good one.";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function buildTodaySectionText(args: {
  data: TodaySectionData;
  tz: string;
  locale?: DigestLocale;
  // Reference "now" for the due-today vs due-future tag. Injectable for
  // deterministic tests; defaults to the real clock in production.
  now?: Date;
}): string {
  const locale = args.locale ?? "en";
  const now = args.now ?? new Date();
  const { events, assignments } = args.data;
  const lines: string[] = [];
  lines.push(heading(locale));

  if (events.length === 0 && assignments.length === 0) {
    lines.push(`  ${emptyLine(locale)}`);
    lines.push("");
    return lines.join("\n");
  }

  if (events.length > 0) {
    lines.push(`${eventsLabel(locale)}:`);
    for (const e of events) {
      const time = e.allDay
        ? allDayLabel(locale)
        : formatEventTime(e.start, args.tz);
      lines.push(`  • ${time} — ${e.title}`);
    }
  }

  if (assignments.length > 0) {
    lines.push(`${dueLabel(locale)}:`);
    for (const a of assignments) {
      const tag = dueTagForAssignment(a, args.tz, locale, now);
      const cls = a.classTitle ? ` (${a.classTitle})` : "";
      lines.push(`  • [${tag}] ${a.title}${cls}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function buildTodaySectionHtml(args: {
  data: TodaySectionData;
  tz: string;
  locale?: DigestLocale;
  now?: Date;
}): string {
  const locale = args.locale ?? "en";
  const now = args.now ?? new Date();
  const { events, assignments } = args.data;

  const headingHtml = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">${escapeHtml(
    heading(locale)
  )}</div>`;

  if (events.length === 0 && assignments.length === 0) {
    return `
            <tr>
              <td style="padding: 16px 24px 0 24px;">
                ${headingHtml}
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #6E6A64; margin-top: 6px;">${escapeHtml(
                  emptyLine(locale)
                )}</div>
              </td>
            </tr>`;
  }

  const eventRows = events
    .map((e) => {
      const time = e.allDay
        ? allDayLabel(locale)
        : formatEventTime(e.start, args.tz);
      return `
                  <tr>
                    <td style="padding: 5px 0; border-bottom: 1px solid #E4E0DB;">
                      <span style="display: inline-block; min-width: 48px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #6E6A64;">${escapeHtml(
                        time
                      )}</span>
                      <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814;">${escapeHtml(
                        e.title
                      )}</span>
                    </td>
                  </tr>`;
    })
    .join("");

  const dueRows = assignments
    .map((a) => {
      const tag = dueTagForAssignment(a, args.tz, locale, now);
      const tagColor = a.overdue ? "#DC2626" : "#D97706";
      const cls = a.classTitle
        ? ` <span style="color: #6E6A64;">(${escapeHtml(a.classTitle)})</span>`
        : "";
      return `
                  <tr>
                    <td style="padding: 5px 0; border-bottom: 1px solid #E4E0DB;">
                      <span style="display: inline-block; min-width: 64px; padding: 2px 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; color: ${tagColor};">${escapeHtml(
                        tag
                      )}</span>
                      <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814;">${escapeHtml(
                        a.title
                      )}${cls}</span>
                    </td>
                  </tr>`;
    })
    .join("");

  const eventsBlock =
    events.length > 0
      ? `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #1A1814; margin-top: 8px;">${escapeHtml(
                  eventsLabel(locale)
                )}</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${eventRows}</table>`
      : "";

  const dueBlock =
    assignments.length > 0
      ? `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #1A1814; margin-top: 8px;">${escapeHtml(
                  dueLabel(locale)
                )}</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${dueRows}</table>`
      : "";

  return `
            <tr>
              <td style="padding: 16px 24px 0 24px;">
                ${headingHtml}${eventsBlock}${dueBlock}
              </td>
            </tr>`;
}

// Gather + render in one call. Returns null only when the loaders throw
// catastrophically (they're individually fail-soft, so this is defensive).
export async function loadTodaySection(args: {
  userId: string;
  tz: string;
  locale: DigestLocale;
  now?: Date;
}): Promise<RenderedTodaySection> {
  const { getDigestTodayEvents, getDigestDueOrOverdue } = await import(
    "@/lib/dashboard/today"
  );
  const [events, assignments] = await Promise.all([
    getDigestTodayEvents(args.userId, args.tz),
    getDigestDueOrOverdue(args.userId, args.tz, args.now),
  ]);
  const data: TodaySectionData = { events, assignments };
  const now = args.now ?? new Date();
  return {
    text: buildTodaySectionText({ data, tz: args.tz, locale: args.locale, now }),
    html: buildTodaySectionHtml({ data, tz: args.tz, locale: args.locale, now }),
    hasContent: events.length > 0 || assignments.length > 0,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
