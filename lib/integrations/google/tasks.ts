import "server-only";
import { google, type tasks_v1 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { decryptOAuthToken } from "@/lib/auth/oauth-tokens";
import { persistRefreshedOAuthToken } from "@/lib/auth/oauth-refresh-persist";

export class TasksNotConnectedError extends Error {
  code = "TASKS_NOT_CONNECTED" as const;
  constructor() {
    super("Google Tasks is not connected for this user.");
  }
}

export async function getTasksForUser(
  userId: string
): Promise<tasks_v1.Tasks> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!row) throw new TasksNotConnectedError();
  if (!row.scope?.includes("tasks")) throw new TasksNotConnectedError();

  const e = env();
  const oauth2 = new google.auth.OAuth2(e.AUTH_GOOGLE_ID, e.AUTH_GOOGLE_SECRET);
  oauth2.setCredentials({
    access_token: decryptOAuthToken(row.access_token) ?? undefined,
    refresh_token: decryptOAuthToken(row.refresh_token) ?? undefined,
    expiry_date: row.expires_at ? row.expires_at * 1000 : undefined,
    scope: row.scope ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await persistRefreshedOAuthToken({
        provider: "google",
        providerAccountId: row.providerAccountId,
        accessTokenPlain: tokens.access_token,
        expiresAtSeconds: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : row.expires_at,
      });
    }
  });

  return google.tasks({ version: "v1", auth: oauth2 });
}

// Strip bogus time from `due`: Google returns YYYY-MM-DDT00:00:00.000Z but the
// time is meaningless — treat the leading YYYY-MM-DD as a local-date-only value.
export function dueDateOnly(due: string | null | undefined): string | null {
  if (!due) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(due);
  return m ? m[1] : null;
}

// Inverse: build the `due` wire format Google expects for a local date.
export function dueFromDateOnly(date: string): string {
  return `${date}T00:00:00.000Z`;
}

// Phase 7 W1 — light-weight task row used by the L2 fanout's calendar
// source. Mirrors `DraftCalendarEvent` so the same prompt block can render
// both events and tasks (a task is just "a thing due on a date with no
// time"). Pulled live from Google Tasks, not from the local `events`
// mirror — the mirror is sync-job populated and the agent runs async.
export type DraftCalendarTask = {
  title: string;
  due: string; // YYYY-MM-DD, local-date-only
  notes: string | null;
  completed: boolean;
};

// Live fetch of incomplete tasks due in a window around today.
// `days` controls the FORWARD window (default 7). `daysBack` controls
// the BACKWARD window for catching overdue items (default 0 — fanout
// L2 callers want forward-only context). The home /app/tasks pages
// pass daysBack > 0 so a Google Task with `due=yesterday` still
// surfaces in "今日のタスク" view alongside today's tasks.
//
// Soft-fails when the user hasn't connected Tasks (no scope grant) —
// the fanout treats that as "no tasks block to render," same as the
// calendar path.
export async function fetchUpcomingTasks(
  userId: string,
  options: { days?: number; daysBack?: number; max?: number } = {}
): Promise<DraftCalendarTask[]> {
  const days = options.days ?? 7;
  const daysBack = options.daysBack ?? 0;
  const max = options.max ?? 25;
  let tasks;
  try {
    tasks = await getTasksForUser(userId);
  } catch (e) {
    if (e instanceof TasksNotConnectedError) return [];
    throw e;
  }

  // Pull all tasklists, then merge their tasks. α users typically have 1-2
  // lists; the per-list fan-out is bounded.
  let lists;
  try {
    lists = await tasks.tasklists.list({ maxResults: 100 });
  } catch {
    return [];
  }
  const ids = (lists.data.items ?? [])
    .map((l) => l.id)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fromDate = start.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  const toDate = end.toISOString().slice(0, 10);

  const out: DraftCalendarTask[] = [];
  for (const id of ids) {
    try {
      const resp = await tasks.tasks.list({
        tasklist: id,
        maxResults: max,
        showCompleted: false,
        showHidden: false,
        dueMin: dueFromDateOnly(fromDate),
        dueMax: dueFromDateOnly(toDate),
      });
      for (const t of resp.data.items ?? []) {
        const date = dueDateOnly(t.due);
        if (!date || !t.title) continue;
        out.push({
          title: t.title,
          due: date,
          notes: t.notes ?? null,
          completed: t.status === "completed",
        });
        if (out.length >= max) break;
      }
    } catch {
      // Per-list failures are non-fatal — skip and try the next.
    }
    if (out.length >= max) break;
  }
  // Sort by due date ascending so the prompt sees the most-urgent first.
  out.sort((a, b) => a.due.localeCompare(b.due));
  return out;
}
