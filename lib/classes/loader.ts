import "server-only";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";
import type { ClassColor } from "@/components/ui/class-color";
import {
  getCalendarForUser,
  CalendarNotConnectedError,
} from "@/lib/integrations/google/calendar";
import type { TimelineDay, TimelineEvent } from "@/components/ui/timeline-strip";

export type ClassRow = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
  term: string | null;
  color: ClassColor | null;
  status: "active" | "archived";
  dueCount: number;
  mistakesCount: number;
  nextSessionLabel: string | null;
};

export async function loadClasses(userId: string): Promise<ClassRow[]> {
  const notion = await getNotionClientForUser(userId);
  const classesDbId = notion?.connection.classesDbId;
  if (!notion || !classesDbId) return [];
  const { client, connection } = notion;

  // Fire all three Notion queries in parallel. Classes is critical; the
  // other two enrich row counts and are optional — on failure we silently
  // keep counts at 0 rather than dropping the whole page.
  const now = new Date();
  const dueHorizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const mistakeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const classesP = (async () => {
    const dsId = await resolveDataSourceId(client, classesDbId);
    return client.dataSources.query({ data_source_id: dsId, page_size: 100 });
  })();

  const assignmentsP = connection.assignmentsDbId
    ? (async () => {
        const aDs = await resolveDataSourceId(
          client,
          connection.assignmentsDbId!
        );
        return client.dataSources.query({
          data_source_id: aDs,
          page_size: 100,
          filter: {
            and: [
              { property: "Due", date: { on_or_after: now.toISOString() } },
              { property: "Due", date: { on_or_before: dueHorizon.toISOString() } },
            ],
          },
        });
      })().catch(() => null)
    : Promise.resolve(null);

  const mistakesP = connection.mistakesDbId
    ? (async () => {
        const mDs = await resolveDataSourceId(
          client,
          connection.mistakesDbId!
        );
        return client.dataSources.query({
          data_source_id: mDs,
          page_size: 100,
          filter: {
            timestamp: "created_time",
            created_time: { on_or_after: mistakeSince.toISOString() },
          },
        });
      })().catch(() => null)
    : Promise.resolve(null);

  let classesResp: Awaited<typeof classesP>;
  let aResp: Awaited<typeof assignmentsP>;
  let mResp: Awaited<typeof mistakesP>;
  try {
    [classesResp, aResp, mResp] = await Promise.all([
      classesP,
      assignmentsP,
      mistakesP,
    ]);
  } catch {
    return [];
  }

  const rows: ClassRow[] = [];
  for (const raw of classesResp.results as Array<Record<string, unknown>>) {
    const page = raw as { id: string; properties?: Record<string, unknown> };
    const props = page.properties ?? {};
    const name = extractTitle(props);
    if (!name) continue;
    const status = getSelectName(props, "Status") === "archived" ? "archived" : "active";
    rows.push({
      id: page.id,
      name,
      code: getRichText(props, "Code"),
      professor: getRichText(props, "Professor"),
      term: getSelectName(props, "Term"),
      color: getSelectName(props, "Color") as ClassColor | null,
      status,
      dueCount: 0,
      mistakesCount: 0,
      nextSessionLabel: null,
    });
  }

  const classIdToRow = new Map(rows.map((r) => [r.id, r] as const));
  if (aResp) {
    for (const row of aResp.results as Array<Record<string, unknown>>) {
      const p = (row as { properties?: Record<string, unknown> }).properties ?? {};
      if (getSelectName(p, "Status") === "Done") continue;
      for (const id of getRelationIds(p, "Class")) {
        const target = classIdToRow.get(id);
        if (target) target.dueCount += 1;
      }
    }
  }
  if (mResp) {
    for (const row of mResp.results as Array<Record<string, unknown>>) {
      const p = (row as { properties?: Record<string, unknown> }).properties ?? {};
      for (const id of getRelationIds(p, "Class")) {
        const target = classIdToRow.get(id);
        if (target) target.mistakesCount += 1;
      }
    }
  }

  return rows;
}

export async function loadClass(
  userId: string,
  classId: string
): Promise<ClassRow | null> {
  const all = await loadClasses(userId);
  return all.find((c) => c.id === classId) ?? null;
}

export type ClassSession = TimelineEvent;

export async function loadTimelineForToday(
  userId: string
): Promise<TimelineDay[]> {
  try {
    const cal = await getCalendarForUser(userId);
    const makeDay = (offset: number): TimelineDay["events"] => [];
    const events: Record<0 | 1, TimelineEvent[]> = {
      0: makeDay(0),
      1: makeDay(1),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(today);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: today.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    for (const e of resp.data.items ?? []) {
      const startIso = e.start?.dateTime;
      const endIso = e.end?.dateTime;
      if (!startIso || !endIso) continue;
      const s = new Date(startIso);
      const t = new Date(endIso);
      const offset = sameDay(s, today) ? 0 : sameDay(s, addDays(today, 1)) ? 1 : -1;
      if (offset === -1) continue;
      events[offset as 0 | 1].push({
        start: s,
        end: t,
        title: e.summary ?? "(untitled)",
        color: null,
      });
    }

    return [
      { label: "Today", events: events[0] },
      { label: "Tomorrow", events: events[1] },
    ];
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return [];
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

function getRichText(props: Record<string, unknown>, key: string): string | null {
  const v = props[key] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!v?.rich_text?.length) return null;
  return v.rich_text.map((t) => t.plain_text ?? "").join("").trim() || null;
}

function getSelectName(props: Record<string, unknown>, key: string): string | null {
  const v = props[key] as { select?: { name?: string } | null } | undefined;
  return v?.select?.name ?? null;
}

function getRelationIds(props: Record<string, unknown>, key: string): string[] {
  const v = props[key] as { relation?: Array<{ id?: string }> } | undefined;
  return v?.relation?.map((r) => r.id).filter((id): id is string => Boolean(id)) ?? [];
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
