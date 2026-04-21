import "server-only";
import { z } from "zod";
import {
  dueDateOnly,
  dueFromDateOnly,
  getTasksForUser,
} from "@/lib/integrations/google/tasks";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
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
      "List Google Tasks from the primary task list. `dueMin`/`dueMax` are YYYY-MM-DD local dates (end-exclusive). Results are flat — subtasks appear alongside parents but retain their parentId.",
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
    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    const includeCompleted = args.includeCompleted ?? true;
    const resp = await tasks.tasks.list({
      tasklist: taskListId,
      maxResults: args.limit ?? 100,
      showCompleted: includeCompleted,
      showHidden: includeCompleted,
      dueMin: args.dueMin ? dueFromDateOnly(args.dueMin) : undefined,
      dueMax: args.dueMax ? dueFromDateOnly(args.dueMax) : undefined,
    });
    const items: TaskListed[] = (resp.data.items ?? [])
      .filter((t): t is typeof t & { id: string } => Boolean(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title ?? "(untitled)",
        notes: t.notes ?? null,
        due: dueDateOnly(t.due),
        status: t.status === "completed" ? "completed" : "needsAction",
        taskListId,
        parentId: t.parent ?? null,
      }));
    return { tasks: items };
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

export const tasksCreateTask: ToolExecutor<
  z.infer<typeof createArgs>,
  { taskId: string; taskListId: string }
> = {
  schema: {
    name: "tasks_create",
    description:
      "Create a Google Task. `due` is YYYY-MM-DD (local-date-only; Google Tasks doesn't support times). Defaults to the primary task list.",
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
    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    try {
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
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.create",
        toolName: "tasks_create",
        resourceId: taskId,
        result: "success",
        detail: { title: args.title },
      });
      return { taskId, taskListId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.create",
        toolName: "tasks_create",
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
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
    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    try {
      await tasks.tasks.patch({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: args.completed
          ? { status: "completed" }
          : { status: "needsAction", completed: null },
      });
      await logAudit({
        userId: ctx.userId,
        action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
        toolName: "tasks_complete",
        resourceId: args.taskId,
        result: "success",
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: args.completed ? "tasks.task.complete" : "tasks.task.reopen",
        toolName: "tasks_complete",
        resourceId: args.taskId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
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
    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    const body: Record<string, unknown> = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.notes !== undefined) body.notes = args.notes;
    if (args.due !== undefined) {
      body.due = args.due === null ? null : dueFromDateOnly(args.due);
    }
    try {
      await tasks.tasks.patch({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: body,
      });
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.update",
        toolName: "tasks_update",
        resourceId: args.taskId,
        result: "success",
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.update",
        toolName: "tasks_update",
        resourceId: args.taskId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
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
    const tasks = await getTasksForUser(ctx.userId);
    const taskListId = args.taskListId ?? "@default";
    try {
      await tasks.tasks.delete({
        tasklist: taskListId,
        task: args.taskId,
      });
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.delete",
        toolName: "tasks_delete",
        resourceId: args.taskId,
        result: "success",
      });
      return { taskId: args.taskId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "tasks.task.delete",
        toolName: "tasks_delete",
        resourceId: args.taskId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

export const TASKS_TOOLS = [
  tasksListEvents,
  tasksCreateTask,
  tasksCompleteTask,
  tasksUpdateTask,
  tasksDeleteTask,
];
