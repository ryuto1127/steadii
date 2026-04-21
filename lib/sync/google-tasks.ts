import "server-only";
import {
  TasksNotConnectedError,
  dueDateOnly,
  dueFromDateOnly,
  getTasksForUser,
} from "@/lib/integrations/google/tasks";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  type AdapterResult,
  type CanonicalEventInput,
  getGoogleAccountId,
  registerAdapter,
  softDeleteMissing,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

async function sync(
  userId: string,
  fromISO: string,
  toISO: string
): Promise<AdapterResult> {
  let tasks;
  try {
    tasks = await getTasksForUser(userId);
  } catch (err) {
    if (err instanceof TasksNotConnectedError) {
      return { ok: true, upserted: 0, softDeleted: 0 };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const accountId = (await getGoogleAccountId(userId)) ?? "unknown";
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;

  let taskLists;
  try {
    taskLists = await tasks.tasklists.list({ maxResults: 100 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const lists = (taskLists.data.items ?? []).filter(
    (l): l is typeof l & { id: string } => Boolean(l.id)
  );

  const keepIds = new Set<string>();
  let upserted = 0;

  for (const list of lists) {
    try {
      const resp = await tasks.tasks.list({
        tasklist: list.id,
        maxResults: 100,
        showCompleted: true,
        showHidden: true,
        dueMin: dueFromDateOnly(fromISO.slice(0, 10)),
        dueMax: dueFromDateOnly(toISO.slice(0, 10)),
      });
      for (const t of resp.data.items ?? []) {
        if (!t.id) continue;
        const date = dueDateOnly(t.due);
        if (!date) continue; // skip undated — not calendar material
        const startsAt = localMidnightAsUtc(date, userTz);
        const status =
          t.status === "completed"
            ? ("completed" as const)
            : ("needs_action" as const);
        const row: CanonicalEventInput = {
          userId,
          sourceType: "google_tasks",
          sourceAccountId: accountId,
          externalId: t.id,
          externalParentId: list.id,
          kind: "task",
          title: t.title ?? "(untitled)",
          description: t.notes ?? null,
          startsAt,
          endsAt: null,
          isAllDay: true,
          originTimezone: userTz,
          location: null,
          url: t.selfLink ?? null,
          status,
          sourceMetadata: {
            taskListId: list.id,
            taskListTitle: list.title ?? null,
            parentTaskId: t.parent ?? null,
            dueDate: date,
            dueDateEndExclusive: addDaysToDateStr(date, 1),
          },
          normalizedKey: null,
        };
        await upsertFromSourceRow(row);
        keepIds.add(t.id);
        upserted += 1;
      }
    } catch (err) {
      console.error(
        `[sync/google-tasks] list ${list.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let softDeleted = 0;
  try {
    softDeleted = await softDeleteMissing(
      userId,
      "google_tasks",
      fromISO,
      toISO,
      keepIds
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, upserted, softDeleted };
}

registerAdapter("google_tasks", sync);

export const syncRange = sync;
