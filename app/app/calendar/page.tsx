import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { calendarListEvents } from "@/lib/agent/tools/calendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  let events: Array<{
    id: string | null | undefined;
    summary: string | null | undefined;
    start: string | null | undefined;
    end: string | null | undefined;
    location?: string | null;
  }> = [];
  let err: string | null = null;
  try {
    const res = await calendarListEvents.execute({ userId }, { limit: 50 });
    events = res.events;
  } catch (e) {
    err = e instanceof Error ? e.message : "failed to load";
  }

  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const d = (e.start ?? "").slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(e);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-3xl">Calendar</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Next 7 days — primary calendar. Agent-driven edits reflect here on next
        reload.
      </p>
      {err && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--destructive)/0.1)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {err}
        </div>
      )}
      {!err && byDay.size === 0 && (
        <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Nothing scheduled this week.
        </p>
      )}
      <div className="mt-8 space-y-6">
        {[...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, dayEvents]) => (
            <section key={day} className="rounded-xl bg-[hsl(var(--surface))] p-4 shadow-sm">
              <h2 className="text-sm font-medium">{day}</h2>
              <ul className="mt-3 space-y-2">
                {dayEvents.map((ev, i) => (
                  <li
                    key={ev.id ?? i}
                    className="flex items-baseline justify-between gap-4 rounded-lg bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{ev.summary ?? "(untitled)"}</span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {formatTime(ev.start)} → {formatTime(ev.end)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}

function formatTime(s: string | null | undefined): string {
  if (!s) return "?";
  if (s.length === 10) return "all-day";
  try {
    return new Date(s).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}
