export type UserContextPayload = {
  // The user's persisted IANA timezone (e.g. "America/Vancouver"). Null when
  // we haven't captured one yet — callers fall back to UTC and the agent
  // emits a warning so we can see which users still need backfill.
  timezone: string | null;
  notion: {
    connected: boolean;
    parentPageId: string | null;
    classesDbId: string | null;
    mistakesDbId: string | null;
    assignmentsDbId: string | null;
    syllabiDbId: string | null;
  };
  registeredResources: Array<{
    kind: "page" | "database";
    notionId: string;
    title: string | null;
  }>;
  academicCounts?: {
    classes: number;
    assignmentsActive: number;
    mistakeNotes: number;
    syllabi: number;
  };
  calendarEventsThisWeek?: Array<{
    summary: string | null | undefined;
    start: string | null | undefined;
    end: string | null | undefined;
  }>;
};

// Format `date` as a full offset-bearing RFC3339 string in `tz`, e.g.
// "2026-04-20T14:32:00-07:00". Intl handles DST transitions; we never do
// manual offset math.
function formatNowIsoInZone(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const minute = get("minute");
  const second = get("second");
  const offsetRaw = get("timeZoneName"); // "GMT-07:00" or "GMT" for UTC
  const offset = offsetRaw && offsetRaw !== "GMT" ? offsetRaw.replace("GMT", "") : "+00:00";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

function formatTodayInZone(date: Date, tz: string): { ymd: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
  };
}

export function serializeContextForPrompt(ctx: UserContextPayload): string {
  const lines: string[] = [];

  const now = new Date();
  let tz = ctx.timezone;
  if (!tz) {
    console.warn("[serialize-context] user has no timezone set; falling back to UTC");
    tz = "UTC";
  }
  const nowIso = formatNowIsoInZone(now, tz);
  const today = formatTodayInZone(now, tz);
  lines.push(`# Time`);
  lines.push(`Now: ${nowIso} (${tz})`);
  lines.push(`Today (user-local): ${today.ymd} (${today.weekday})`);
  lines.push(
    `When the user says relative dates ("today", "tomorrow", "next Monday", "明日", "来週"), resolve them against Today (user-local), not UTC.`
  );
  lines.push(
    `When you call calendar tools, emit RFC3339 timestamps WITH the user's timezone offset (e.g. 2026-04-21T08:00:00${nowIso.slice(-6)}). Never emit a bare datetime without offset, and never use Z unless the user explicitly asks for UTC.`
  );
  lines.push("");

  lines.push(`# User context (Steadii runtime state)`);
  if (ctx.academicCounts) {
    lines.push(
      `Academic store (Postgres): ${ctx.academicCounts.classes} classes, ${ctx.academicCounts.assignmentsActive} active assignments, ${ctx.academicCounts.mistakeNotes} mistake notes, ${ctx.academicCounts.syllabi} syllabi.`
    );
  }
  lines.push(
    `Notion connected: ${ctx.notion.connected ? "yes (optional one-way import surface; Postgres is canonical)" : "no"}`
  );
  if (ctx.notion.connected) {
    lines.push(`Steadii parent page: ${ctx.notion.parentPageId ?? "(not set up)"}`);
    lines.push(`Classes DB: ${ctx.notion.classesDbId ?? "(not set up)"}`);
    lines.push(`Mistake Notes DB: ${ctx.notion.mistakesDbId ?? "(not set up)"}`);
    lines.push(`Assignments DB: ${ctx.notion.assignmentsDbId ?? "(not set up)"}`);
    lines.push(`Syllabi DB: ${ctx.notion.syllabiDbId ?? "(not set up)"}`);
  }
  if (ctx.registeredResources.length) {
    lines.push(`Registered resources:`);
    for (const r of ctx.registeredResources) {
      lines.push(`  - [${r.kind}] ${r.title ?? "(untitled)"} → ${r.notionId}`);
    }
  }
  if (ctx.calendarEventsThisWeek && ctx.calendarEventsThisWeek.length > 0) {
    lines.push(`Calendar (next 7 days):`);
    for (const e of ctx.calendarEventsThisWeek) {
      lines.push(`  - ${e.start ?? "?"} → ${e.end ?? "?"}: ${e.summary ?? "(untitled)"}`);
    }
  }
  return lines.join("\n");
}
