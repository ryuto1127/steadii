import "server-only";
import {
  getMsAccount,
  getMsGraphForUser,
  MsNotConnectedError,
} from "./graph-client";
import {
  dueDateOnly,
  type DraftCalendarTask,
} from "@/lib/integrations/google/tasks";

// Mirrors `fetchUpcomingTasks` for Microsoft To Do. Soft-fails on missing
// connection / scope so the fanout can concat with Google tasks without
// branching. α users typically have a single default list ("Tasks"); the
// per-list fan-out is bounded.
export async function fetchMsUpcomingTasks(
  userId: string,
  options: { days?: number; max?: number } = {}
): Promise<DraftCalendarTask[]> {
  const days = options.days ?? 7;
  const max = options.max ?? 25;

  const acct = await getMsAccount(userId);
  if (!acct) return [];
  if (!acct.scope?.toLowerCase().includes("tasks.read")) return [];

  let client;
  try {
    client = await getMsGraphForUser(userId);
  } catch (e) {
    if (e instanceof MsNotConnectedError) return [];
    throw e;
  }

  type GraphList = { id?: string | null };
  type GraphTask = {
    title?: string | null;
    body?: { content?: string | null } | null;
    dueDateTime?: { dateTime?: string | null; timeZone?: string | null } | null;
    status?:
      | "notStarted"
      | "inProgress"
      | "completed"
      | "waitingOnOthers"
      | "deferred"
      | null;
  };

  const listsResp = (await client
    .api("/me/todo/lists")
    .query({ $select: "id", $top: "100" })
    .get()) as { value?: GraphList[] };

  const listIds = (listsResp.value ?? [])
    .map((l) => l.id)
    .filter((id): id is string => !!id);
  if (listIds.length === 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromIso = today.toISOString();
  const end = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  const toIso = end.toISOString();

  const out: DraftCalendarTask[] = [];

  for (const listId of listIds) {
    try {
      const tasksResp = (await client
        .api(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`)
        .query({
          // Filter incomplete + due in window. Graph $filter requires the
          // datetime literal — note no quotes around the value.
          $filter: `status ne 'completed' and dueDateTime/dateTime ge '${fromIso}' and dueDateTime/dateTime lt '${toIso}'`,
          $top: String(max),
          $select: "title,body,dueDateTime,status",
        })
        .get()) as { value?: GraphTask[] };

      for (const t of tasksResp.value ?? []) {
        if (!t.title) continue;
        const date = dueDateOnly(t.dueDateTime?.dateTime ?? null);
        if (!date) continue;
        out.push({
          title: t.title,
          due: date,
          notes: t.body?.content?.trim() || null,
          completed: t.status === "completed",
        });
        if (out.length >= max) break;
      }
    } catch {
      // Per-list failures are non-fatal — skip and try the next.
    }
    if (out.length >= max) break;
  }

  out.sort((a, b) => a.due.localeCompare(b.due));
  return out;
}
