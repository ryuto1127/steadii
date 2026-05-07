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
import {
  markDeletedByExternalId,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

// Mirrors `fetchUpcomingTasks` for Microsoft To Do. Soft-fails on missing
// connection / scope so the fanout can concat with Google tasks without
// branching. α users typically have a single default list ("Tasks"); the
// per-list fan-out is bounded.
export async function fetchMsUpcomingTasks(
  userId: string,
  options: { days?: number; daysBack?: number; max?: number } = {}
): Promise<DraftCalendarTask[]> {
  const days = options.days ?? 7;
  const daysBack = options.daysBack ?? 0;
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
    id?: string | null;
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
  // Match the google/tasks fetcher: daysBack > 0 includes overdue
  // tasks so the home /app + /app/tasks views can surface still-pending
  // past-due items alongside today's tasks. Default 0 keeps the L2
  // fanout / forward-looking callers unchanged.
  const start = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fromIso = start.toISOString();
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
          $select: "id,title,body,dueDateTime,status",
        })
        .get()) as { value?: GraphTask[] };

      for (const t of tasksResp.value ?? []) {
        if (!t.title || !t.id) continue;
        const date = dueDateOnly(t.dueDateTime?.dateTime ?? null);
        if (!date) continue;
        out.push({
          title: t.title,
          due: date,
          notes: t.body?.content?.trim() || null,
          completed: t.status === "completed",
          taskId: t.id,
          taskListId: listId,
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

type GraphTaskRow = {
  id?: string | null;
  title?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  dueDateTime?: { dateTime?: string | null; timeZone?: string | null } | null;
  status?:
    | "notStarted"
    | "inProgress"
    | "completed"
    | "waitingOnOthers"
    | "deferred"
    | null;
  importance?: "low" | "normal" | "high" | null;
};

type GraphListRow = {
  id?: string | null;
  displayName?: string | null;
  wellknownListName?: string | null;
};

// Resolve the user's "default" task list id. Each MS account has a single
// flagged list (`wellknownListName: "defaultList"`) — we pick that one when
// no explicit listId is supplied. Falls back to the first list if Graph
// somehow returns no flagged default.
async function resolveDefaultListId(
  userId: string
): Promise<string | null> {
  const client = await getMsGraphForUser(userId);
  const resp = (await client
    .api("/me/todo/lists")
    .query({ $select: "id,displayName,wellknownListName", $top: "100" })
    .get()) as { value?: GraphListRow[] };
  const lists = resp.value ?? [];
  const def = lists.find((l) => l.wellknownListName === "defaultList");
  return def?.id ?? lists[0]?.id ?? null;
}

// Mirror an MS Graph task row into the local `events` table so the
// calendar UI shows the task on its due date and dedup widening can see
// it. Mirrors `writeThroughTask` from the Google agent tool but for
// the MS source. Undated tasks are soft-deleted from the mirror — the
// UI only renders due-on-a-date items.
async function writeThroughMsTask(args: {
  userId: string;
  providerAccountId: string;
  listId: string;
  task: GraphTaskRow;
}): Promise<void> {
  const { task } = args;
  if (!task.id) return;
  const date = dueDateOnly(task.dueDateTime?.dateTime ?? null);
  if (!date) {
    await markDeletedByExternalId(args.userId, "microsoft_todo", task.id);
    return;
  }
  const userTz = (await getUserTimezone(args.userId)) ?? FALLBACK_TZ;
  const startsAt = localMidnightAsUtc(date, userTz);
  const status =
    task.status === "completed"
      ? ("completed" as const)
      : ("needs_action" as const);

  await upsertFromSourceRow({
    userId: args.userId,
    sourceType: "microsoft_todo",
    sourceAccountId: args.providerAccountId,
    externalId: task.id,
    externalParentId: args.listId,
    kind: "task",
    title: task.title ?? "(untitled)",
    description: task.body?.content ?? null,
    startsAt,
    endsAt: null,
    isAllDay: true,
    originTimezone: userTz,
    location: null,
    url: null,
    status,
    sourceMetadata: {
      listId: args.listId,
      dueDate: date,
      dueDateEndExclusive: addDaysToDateStr(date, 1),
      importance: task.importance ?? null,
    },
    normalizedKey: null,
  });
}

export type MsTaskCreateInput = {
  userId: string;
  title: string;
  notes?: string;
  due?: string; // YYYY-MM-DD local-date-only
  listId?: string;
  importance?: "low" | "normal" | "high";
};

// POST /me/todo/lists/{listId}/tasks. When `listId` is omitted, resolves
// the wellknown defaultList. Throws MsNotConnectedError when the user
// hasn't granted Tasks.ReadWrite — agent dispatcher catches and surfaces.
export async function createMsTask(
  input: MsTaskCreateInput
): Promise<{ id: string; listId: string }> {
  const acct = await getMsAccount(input.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("tasks.readwrite")) {
    throw new MsNotConnectedError();
  }
  const listId =
    input.listId ?? (await resolveDefaultListId(input.userId));
  if (!listId) throw new Error("MS To Do has no usable list");

  const client = await getMsGraphForUser(input.userId);
  const userTz =
    (await getUserTimezone(input.userId)) ?? FALLBACK_TZ;

  const body: Record<string, unknown> = {
    title: input.title,
  };
  if (input.notes) {
    body.body = { contentType: "text", content: input.notes };
  }
  if (input.due) {
    body.dueDateTime = {
      dateTime: `${input.due}T00:00:00`,
      timeZone: userTz,
    };
  }
  if (input.importance) body.importance = input.importance;

  const created = (await client
    .api(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`)
    .post(body)) as GraphTaskRow;
  if (!created?.id) {
    throw new Error("MS Graph task create returned no id");
  }
  await writeThroughMsTask({
    userId: input.userId,
    providerAccountId: acct.providerAccountId,
    listId,
    task: created,
  });
  return { id: created.id, listId };
}

export type MsTaskPatchInput = {
  userId: string;
  taskId: string;
  listId: string;
  patch: {
    title?: string;
    notes?: string | null;
    due?: string | null; // YYYY-MM-DD or null to clear
    status?: "notStarted" | "inProgress" | "completed";
    importance?: "low" | "normal" | "high";
  };
};

// PATCH /me/todo/lists/{listId}/tasks/{taskId}. Used both for completion
// (status="completed") and for editing title/due. Caller supplies the
// listId from the prior list call — the `tasks_list` agent tool surfaces
// it in the task row.
export async function patchMsTask(
  input: MsTaskPatchInput
): Promise<{ id: string }> {
  const acct = await getMsAccount(input.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("tasks.readwrite")) {
    throw new MsNotConnectedError();
  }
  const client = await getMsGraphForUser(input.userId);
  const userTz =
    (await getUserTimezone(input.userId)) ?? FALLBACK_TZ;

  const body: Record<string, unknown> = {};
  if (input.patch.title !== undefined) body.title = input.patch.title;
  if (input.patch.notes !== undefined) {
    body.body =
      input.patch.notes === null
        ? { contentType: "text", content: "" }
        : { contentType: "text", content: input.patch.notes };
  }
  if (input.patch.due !== undefined) {
    if (input.patch.due === null) {
      // MS rejects `dueDateTime: null` in the PATCH body; the documented
      // way to clear a due date is to omit it entirely on a *replace*, but
      // since we use PATCH semantics, we have to call the dedicated
      // /resetDueDate-style action. Practically, omitting a due date for
      // a task is rare — the agent's user-facing flow always sets one.
      // For now, no-op the clear; a follow-up can wire the action endpoint.
    } else {
      body.dueDateTime = {
        dateTime: `${input.patch.due}T00:00:00`,
        timeZone: userTz,
      };
    }
  }
  if (input.patch.status !== undefined) body.status = input.patch.status;
  if (input.patch.importance !== undefined)
    body.importance = input.patch.importance;

  const updated = (await client
    .api(
      `/me/todo/lists/${encodeURIComponent(input.listId)}/tasks/${encodeURIComponent(input.taskId)}`
    )
    .patch(body)) as GraphTaskRow;
  if (updated?.id) {
    await writeThroughMsTask({
      userId: input.userId,
      providerAccountId: acct.providerAccountId,
      listId: input.listId,
      task: updated,
    });
  }
  return { id: input.taskId };
}

// DELETE /me/todo/lists/{listId}/tasks/{taskId}. Caller is expected to
// soft-delete the local mirror via `markDeletedByExternalId` after.
export async function deleteMsTask(args: {
  userId: string;
  listId: string;
  taskId: string;
}): Promise<void> {
  const acct = await getMsAccount(args.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("tasks.readwrite")) {
    throw new MsNotConnectedError();
  }
  const client = await getMsGraphForUser(args.userId);
  await client
    .api(
      `/me/todo/lists/${encodeURIComponent(args.listId)}/tasks/${encodeURIComponent(args.taskId)}`
    )
    .delete();
}
