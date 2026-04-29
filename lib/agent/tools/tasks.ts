import "server-only";
import { z } from "zod";
import {
  dueFromDateOnly,
  getTasksForUser,
} from "@/lib/integrations/google/tasks";
import {
  createMsTask,
  deleteMsTask,
  patchMsTask,
} from "@/lib/integrations/microsoft/tasks";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import {
  getGoogleAccountId,
  listEventsInRange,
  markDeletedByExternalId,
  shouldSync,
  syncAllForRange,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";
import {
  getConnectedTasksProviders,
  lookupEventSource,
} from "./connected-providers";
import type { ToolExecutor } from "./types";

async function logAudit(args: {
  userId: string;
  action: string;
  toolName: string;
  resourceId?: string | null;
  result: "success" | "failure";
  detail?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    action: args.action,
    toolName: args.toolName,
    resourceType: "google_task",
    resourceId: args.resourceId ?? null,
    result: args.result,
    detail: args.detail ?? null,
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = z.string().regex(DATE_ONLY, "Expected YYYY-MM-DD");

// ---------- tasks_list ----------
const listArgs = z.object({
  dueMin: dateOnly.optional(),
  dueMax: dateOnly.optional(),
  taskListId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  includeCompleted: z.boolean().optional(),
});

export type TaskListed = {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  status: "needsAction" | "completed";
  taskListId: string;
  parentId: string | null;
};

export const tasksListEvents: ToolExecutor<
  z.infer<typeof listArgs>,
  { tasks: TaskListed[] }
> = {
  schema: {
    name: "tasks_list",
    description:
      "List Google Tasks from the primary task list. `dueMin`/`dueMax` are YYYY-MM-DD local dates (end-exclusive). Results are flat — subtasks appear alongside parents but retain their parentId. Reads from the unified event store (synced from Google on demand).",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        dueMin: { type: "string" },
        dueMax: { type: "string" },
        taskListId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        includeCompleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listArgs.parse(rawArgs);
    const userTz = (await getUserTimezone(ctx.userId)) ?? FALLBACK_TZ;

    // Default window: next 30 days in user tz if nothing passed.
    const now = new Date();
    const defaultFrom = now.toISOString();
    const defaultTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const fromISO = args.dueMin
      ? localMidnightAsUtc(args.dueMin, userTz).toISOString()
      : defaultFrom;
    const toISO = args.dueMax
      ? localMidnightAsUtc(args.dueMax, userTz).toISOString()
      : defaultTo;

    if (shouldSync(ctx.userId, fromISO, toISO)) {
      await syncAllForRange(ctx.userId, fromISO, toISO);
    }
    const rows = await listEventsInRange(ctx.userId, fromISO, toISO, {
      sourceTypes: ["google_tasks", "microsoft_todo"],
    });
    const includeCompleted = args.includeCompleted ?? true;
    const limit = args.limit ?? 100;
    const out: TaskListed[] = [];
    for (const r of rows) {
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const listId = (meta.taskListId as string | undefined) ?? "@default";
      if (args.taskListId && args.taskListId !== "@default" && listId !== args.taskListId) {
        continue;
      }
      if (!includeCompleted && r.status === "completed") continue;
      const dueDate = (meta.dueDate as string | undefined) ?? null;
      out.push({
        id: r.externalId,
        title: r.title,
        notes: r.description ?? null,
        due: dueDate,
        status: r.status === "completed" ? "completed" : "needsAction",
        taskListId: listId,
        parentId: (meta.parentTaskId as string | null | undefined) ?? null,
      });
      if (out.length >= limit) break;
    }
    return { tasks: out };
  },
};

// ---------- tasks_create ----------
const createArgs = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  due: dateOnly.optional(),
  taskListId: z.string().optional(),
  parentId: z.string().optional(),
});

export type TasksCreateResult = {
  taskId: string;
  taskListId: string;
  createdIn: Array<"google_tasks" | "microsoft_todo">;
  failedIn: Array<{ source: "google_tasks" | "microsoft_todo"; error: string }>;
};

export const tasksCreateTask: ToolExecutor<
  z.infer<typeof createArgs>,
  TasksCreateResult
> = {
  schema: {
    name: "tasks_create",
    description:
      "Create a task. By default writes to ALL the user's connected tasks integrations (Google Tasks + Microsoft To Do). `due` is YYYY-MM-DD (local-date-only; neither provider supports time-of-day on tasks). Microsoft uses the wellknown defaultList; Google uses the primary task list.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string" },
        taskListId: { type: "string" },
        parentId: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = createArgs.parse(rawArgs);
    const providers = await getConnectedTasksProviders(ctx.userId);
    const targets = providers.length > 0 ? providers : (["google"] as const);

    const createdIn: TasksCreateResult["createdIn"] = [];
    const failedIn: TasksCreateResult["failedIn"] = [];
    let primaryTaskId = "";
    let primaryListId = args.taskListId ?? "@default";

    for (const target of targets) {
      if (target === "google") {
        try {
          const tasks = await getTasksForUser(ctx.userId);
          const taskListId = args.taskListId ?? "@default";
          const resp = await tasks.tasks.insert({
            tasklist: taskListId,
            parent: args.parentId,
            requestBody: {
              title: args.title,
              notes: args.notes,
              due: args.due ? dueFromDateOnly(args.due) : undefined,
            },
          });
          const taskId = resp.data.id ?? "";
          await writeThroughTask(ctx.userId, taskListId, resp.data);
          await logAudit({
            userId: ctx.userId,
            action: "tasks.task.create",
            toolName: "tasks_create",
            resourceId: taskId,
            result: "success",
            detail: { title: args.title, source: "google_tasks" },
          });
          createdIn.push("google_tasks");
          if (!primaryTaskId) {
            primaryTaskId = taskId;
            primaryListId = taskListId;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failedIn.push({ source: "google_tasks", error: message });
          await logAudit({
            userId: ctx.userId,
            action: "tasks.task.create",
            toolName: "tasks_create",
            result: "failure",
            detail: { message, source: "google_tasks" },
          });
        }
      } else if (target === "microsoft-entra-id") {
        try {
          const created = await createMsTask({
            userId: ctx.userId,
            title: args.title,
            notes: args.notes,
            due: args.due,
          });
          await logAudit({
            userId: ctx.userId,
            action: "tasks.task.create",
            toolName: "tasks_create",
            resourceId: created.id,
            result: "success",
            detail: { title: args.title, source: "microsoft_todo" },
          });
          createdIn.push("microsoft_todo");
          if (!primaryTaskId) {
            primaryTaskId = created.id;
            primaryListId = created.listId;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failedIn.push({ source: "microsoft_todo", error: message });
          await logAudit({
            userId: ctx.userId,
            action: "tasks.task.create",
            toolName: "tasks_create",
            result: "failure",
            detail: { message, source: "microsoft_todo" },
          });
        }
      }
    }

    if (createdIn.length === 0) {
      const first = failedIn[0]?.error ?? "no tasks provider connected";
      throw new Error(first);
    }

    return {
      taskId: primaryTaskId,
      taskListId: primaryListId,
      createdIn,
      failedIn,
    };
  },
};

// ---------- tasks_complete ----------
const completeArgs = z.object({
  taskId: z.string().min(1),
  taskListId: z.string().optional(),
  completed: z.boolean(),
});

export const tasksCompleteTask: ToolExecutor<
  z.infer<typeof completeArgs>,
  { taskId: string }
> = {
  schema: {
    name: "tasks_complete",
    description:
      "Toggle a task between completed and not-completed. Pass `completed: true` to mark done, `false` to reopen.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
        completed: { type: "boolean" },
      },
      required: ["taskId", "completed"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = completeArgs.parse(rawArgs);
    const source = await lookupEventSource({
      userId: ctx.userId,
      externalId: args.taskId,
    });
    const isMs = source === "microsoft_todo";

    if (isMs) {
      const listId = args.taskListId ?? (await lookupMsTaskListId(ctx.userId, args.taskId));
      if (!listId) {
        throw new Error("MS task list id not found for this task");
      }
      try {
        await patchMsTask({
          userId: ctx.userId,
          taskId: args.taskId,
          listId,
          patch: {
            status: args.completed ? "completed" : "notStarted",
          },
        });
        await logAudit({
          userId: ctx.userId,
          action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
          toolName: "tasks_complete",
          resourceId: args.taskId,
          result: "success",
          detail: { source: "microsoft_todo" },
        });
        return { taskId: args.taskId };
      } catch (err) {
        await logAudit({
          userId: ctx.userId,
          action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
          toolName: "tasks_complete",
          resourceId: args.taskId,
          result: "failure",
          detail: {
            message: err instanceof Error ? err.message : String(err),
            source: "microsoft_todo",
          },
        });
        throw err;
      }
    }

    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    try {
      const resp = await tasks.tasks.patch({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: args.completed
          ? { status: "completed" }
          : { status: "needsAction", completed: null },
      });
      await writeThroughTask(ctx.userId, taskListId, resp.data);
      await logAudit({
        userId: ctx.userId,
        action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
        toolName: "tasks_complete",
        resourceId: args.taskId,
        result: "success",
        detail: { source: "google_tasks" },
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
        toolName: "tasks_complete",
        resourceId: args.taskId,
        result: "failure",
        detail: {
          message: err instanceof Error ? err.message : String(err),
          source: "google_tasks",
        },
      });
      throw err;
    }
  },
};

// ---------- tasks_update ----------
const updateArgs = z.object({
  taskId: z.string().min(1),
  taskListId: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().nullable().optional(),
  due: dateOnly.nullable().optional(),
});

export const tasksUpdateTask: ToolExecutor<
  z.infer<typeof updateArgs>,
  { taskId: string }
> = {
  schema: {
    name: "tasks_update",
    description:
      "Patch a task's title, notes, or due date. Pass `notes: null` or `due: null` to clear. `due` is YYYY-MM-DD.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
        title: { type: "string" },
        notes: { type: ["string", "null"] },
        due: { type: ["string", "null"] },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = updateArgs.parse(rawArgs);
    const source = await lookupEventSource({
      userId: ctx.userId,
      externalId: args.taskId,
    });
    const isMs = source === "microsoft_todo";

    if (isMs) {
      const listId = args.taskListId ?? (await lookupMsTaskListId(ctx.userId, args.taskId));
      if (!listId) {
        throw new Error("MS task list id not found for this task");
      }
      try {
        await patchMsTask({
          userId: ctx.userId,
          taskId: args.taskId,
          listId,
          patch: {
            title: args.title,
            notes: args.notes,
            due: args.due,
          },
        });
        await logAudit({
          userId: ctx.userId,
          action: "tasks.task.update",
          toolName: "tasks_update",
          resourceId: args.taskId,
          result: "success",
          detail: { source: "microsoft_todo" },
        });
        return { taskId: args.taskId };
      } catch (err) {
        await logAudit({
          userId: ctx.userId,
          action: "tasks.task.update",
          toolName: "tasks_update",
          resourceId: args.taskId,
          result: "failure",
          detail: {
            message: err instanceof Error ? err.message : String(err),
            source: "microsoft_todo",
          },
        });
        throw err;
      }
    }

    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    const body: Record<string, unknown> = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.notes !== undefined) body.notes = args.notes;
    if (args.due !== undefined) {
      body.due = args.due === null ? null : dueFromDateOnly(args.due);
    }
    try {
      const resp = await tasks.tasks.patch({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: body,
      });
      await writeThroughTask(ctx.userId, taskListId, resp.data);
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.update",
        toolName: "tasks_update",
        resourceId: args.taskId,
        result: "success",
        detail: { source: "google_tasks" },
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.update",
        toolName: "tasks_update",
        resourceId: args.taskId,
        result: "failure",
        detail: {
          message: err instanceof Error ? err.message : String(err),
          source: "google_tasks",
        },
      });
      throw err;
    }
  },
};

// ---------- tasks_delete ----------
const deleteArgs = z.object({
  taskId: z.string().min(1),
  taskListId: z.string().optional(),
});

export const tasksDeleteTask: ToolExecutor<
  z.infer<typeof deleteArgs>,
  { taskId: string }
> = {
  schema: {
    name: "tasks_delete",
    description: "Delete a task. DESTRUCTIVE: requires user confirmation.",
    mutability: "destructive",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = deleteArgs.parse(rawArgs);
    const source = await lookupEventSource({
      userId: ctx.userId,
      externalId: args.taskId,
    });
    const isMs = source === "microsoft_todo";

    try {
      if (isMs) {
        const listId =
          args.taskListId ?? (await lookupMsTaskListId(ctx.userId, args.taskId));
        if (!listId) {
          throw new Error("MS task list id not found for this task");
        }
        await deleteMsTask({
          userId: ctx.userId,
          listId,
          taskId: args.taskId,
        });
        await markDeletedByExternalId(
          ctx.userId,
          "microsoft_todo",
          args.taskId
        );
      } else {
        const tasks = await getTasksForUser(ctx.userId);
        const taskListId = args.taskListId ?? "@default";
        await tasks.tasks.delete({
          tasklist: taskListId,
          task: args.taskId,
        });
        await markDeletedByExternalId(
          ctx.userId,
          "google_tasks",
          args.taskId
        );
      }
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.delete",
        toolName: "tasks_delete",
        resourceId: args.taskId,
        result: "success",
        detail: { source: isMs ? "microsoft_todo" : "google_tasks" },
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.delete",
        toolName: "tasks_delete",
        resourceId: args.taskId,
        result: "failure",
        detail: {
          message: err instanceof Error ? err.message : String(err),
          source: isMs ? "microsoft_todo" : "google_tasks",
        },
      });
      throw err;
    }
  },
};

// Resolve the MS To Do listId for a given taskId by reading it from the
// local events mirror. The complete/update/delete tools take an optional
// `taskListId` arg, but the agent often only knows the taskId from a prior
// list call — surface the listId from the row's externalParentId so the
// agent doesn't have to thread it explicitly.
async function lookupMsTaskListId(
  userId: string,
  taskId: string
): Promise<string | null> {
  const { events } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ externalParentId: events.externalParentId })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.sourceType, "microsoft_todo"),
        eq(events.externalId, taskId)
      )
    )
    .limit(1);
  return row?.externalParentId ?? null;
}

async function writeThroughTask(
  userId: string,
  taskListId: string,
  t: unknown
): Promise<void> {
  if (!t || typeof t !== "object") return;
  const task = t as {
    id?: string | null;
    title?: string | null;
    notes?: string | null;
    due?: string | null;
    status?: string | null;
    selfLink?: string | null;
    parent?: string | null;
  };
  if (!task.id) return;
  const m = task.due ? /^(\d{4}-\d{2}-\d{2})/.exec(task.due) : null;
  const date = m ? m[1] : null;
  if (!date) {
    // Undated — not calendar material. If an existing row exists, soft-delete.
    await markDeletedByExternalId(userId, "google_tasks", task.id);
    return;
  }
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
  const accountId = (await getGoogleAccountId(userId)) ?? "unknown";
  const startsAt = localMidnightAsUtc(date, userTz);
  const status =
    task.status === "completed" ? ("completed" as const) : ("needs_action" as const);

  await upsertFromSourceRow({
    userId,
    sourceType: "google_tasks",
    sourceAccountId: accountId,
    externalId: task.id,
    externalParentId: taskListId,
    kind: "task",
    title: task.title ?? "(untitled)",
    description: task.notes ?? null,
    startsAt,
    endsAt: null,
    isAllDay: true,
    originTimezone: userTz,
    location: null,
    url: task.selfLink ?? null,
    status,
    sourceMetadata: {
      taskListId,
      parentTaskId: task.parent ?? null,
      dueDate: date,
      dueDateEndExclusive: addDaysToDateStr(date, 1),
    },
    normalizedKey: null,
  });
}

export const TASKS_TOOLS = [
  tasksListEvents,
  tasksCreateTask,
  tasksCompleteTask,
  tasksUpdateTask,
  tasksDeleteTask,
];
