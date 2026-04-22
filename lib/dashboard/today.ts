import "server-only";
import {
  getCalendarForUser,
  CalendarNotConnectedError,
} from "@/lib/integrations/google/calendar";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";
import type { ClassColor } from "@/components/ui/class-color";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  addDaysToDateStr,
  FALLBACK_TZ,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

// Returns "YYYY-MM-DD" for the calendar day the user is currently in,
// evaluated against their persisted IANA timezone. Crucial on Vercel
// (server TZ = UTC) — without this, Vancouver evenings quietly render
// tomorrow's events as "today".
export function todayDateInTz(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export type TodayEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string | null;
  calendarName?: string | null;
};

export type DueSoonAssignment = {
  id: string;
  title: string;
  due: string;
  classColor: ClassColor | null;
  classTitle: string | null;
};

export async function getTodaysEvents(userId: string): Promise<TodayEvent[]> {
  try {
    const cal = await getCalendarForUser(userId);
    const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
    const today = todayDateInTz(tz);
    const start = localMidnightAsUtc(today, tz);
    const end = localMidnightAsUtc(addDaysToDateStr(today, 1), tz);
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 25,
    });
    return (resp.data.items ?? [])
      .filter((e) => e.start?.dateTime || e.start?.date)
      .map((e) => ({
        id: e.id ?? crypto.randomUUID(),
        title: e.summary ?? "(untitled)",
        start: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : ""),
        end: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : ""),
        location: e.location ?? null,
        calendarName: e.organizer?.displayName ?? null,
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return [];
    return [];
  }
}

export async function getDueSoonAssignments(
  userId: string,
  horizonHours = 72
): Promise<DueSoonAssignment[]> {
  const notion = await getNotionClientForUser(userId);
  if (!notion || !notion.connection.assignmentsDbId) return [];
  try {
    const { client, connection } = notion;
    const dsId = await resolveDataSourceId(client, connection.assignmentsDbId!);
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
    const resp = await client.dataSources.query({
      data_source_id: dsId,
      page_size: 25,
      filter: {
        and: [
          {
            property: "Due",
            date: { on_or_after: now.toISOString() },
          },
          {
            property: "Due",
            date: { on_or_before: horizon.toISOString() },
          },
        ],
      },
      sorts: [{ property: "Due", direction: "ascending" }],
    });

    // Resolve class relations → colors + titles.
    const classCache = new Map<string, { title: string; color: ClassColor }>();
    const results: DueSoonAssignment[] = [];

    for (const page of resp.results as Array<Record<string, unknown>>) {
      const props = (page as { properties?: Record<string, unknown> }).properties ?? {};
      const status = (props["Status"] as { select?: { name?: string } } | undefined)?.select?.name;
      if (status === "Done") continue;

      const title = extractTitle(props);
      const due = (props["Due"] as { date?: { start?: string } } | undefined)?.date?.start ?? "";
      const classRel = (
        props["Class"] as { relation?: Array<{ id?: string }> } | undefined
      )?.relation?.[0]?.id;

      let classColor: ClassColor | null = null;
      let classTitle: string | null = null;
      if (classRel) {
        const cached = classCache.get(classRel);
        if (cached) {
          classColor = cached.color;
          classTitle = cached.title;
        } else {
          try {
            const cp = (await client.pages.retrieve({ page_id: classRel })) as {
              properties?: Record<string, unknown>;
            };
            const cprops = cp.properties ?? {};
            const cn = extractTitle(cprops) ?? null;
            const color =
              ((cprops["Color"] as { select?: { name?: string } } | undefined)?.select
                ?.name as ClassColor | undefined) ?? null;
            if (cn && color) classCache.set(classRel, { title: cn, color });
            classTitle = cn;
            classColor = color ?? null;
          } catch {
            // ignore
          }
        }
      }

      if (!title) continue;
      results.push({
        id: (page as { id?: string }).id ?? crypto.randomUUID(),
        title,
        due,
        classColor,
        classTitle,
      });
    }

    return results;
  } catch {
    return [];
  }
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

export function formatTimeRange(
  start: string,
  end: string,
  tz?: string
): string {
  if (!start) return "";
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const fmt = (d: Date) =>
      d.toLocaleTimeString([], {
        ...(tz ? { timeZone: tz } : {}),
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    return e ? `${fmt(s)} — ${fmt(e)}` : fmt(s);
  } catch {
    return "";
  }
}

export function formatRelativeDue(iso: string): string {
  if (!iso) return "";
  const now = Date.now();
  const due = new Date(iso).getTime();
  const diff = due - now;
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}
