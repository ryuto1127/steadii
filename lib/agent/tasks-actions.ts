"use server";

import { auth } from "@/lib/auth/config";
import { revalidatePath } from "next/cache";
import {
  tasksCreateTask,
  tasksUpdateTask,
  tasksCompleteTask,
  tasksDeleteTask,
} from "@/lib/agent/tools/tasks";

export type TaskInput = {
  title: string;
  notes?: string;
  due?: string;
  taskListId?: string;
};

export type TaskPatch = {
  taskId: string;
  taskListId?: string;
  title?: string;
  notes?: string | null;
  due?: string | null;
};

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

export async function createTaskAction(
  input: TaskInput,
): Promise<{ taskId: string; taskListId: string }> {
  const userId = await requireUserId();
  const result = await tasksCreateTask.execute(
    { userId },
    {
      title: input.title,
      notes: input.notes,
      due: input.due,
      taskListId: input.taskListId,
    },
  );
  revalidatePath("/app/calendar");
  return result;
}

export async function updateTaskAction(
  patch: TaskPatch,
): Promise<{ taskId: string }> {
  const userId = await requireUserId();
  await tasksUpdateTask.execute(
    { userId },
    {
      taskId: patch.taskId,
      taskListId: patch.taskListId,
      title: patch.title,
      notes: patch.notes,
      due: patch.due,
    },
  );
  revalidatePath("/app/calendar");
  return { taskId: patch.taskId };
}

export async function completeTaskAction(args: {
  taskId: string;
  taskListId?: string;
  completed: boolean;
}): Promise<{ taskId: string }> {
  const userId = await requireUserId();
  await tasksCompleteTask.execute(
    { userId },
    {
      taskId: args.taskId,
      taskListId: args.taskListId,
      completed: args.completed,
    },
  );
  revalidatePath("/app/calendar");
  return { taskId: args.taskId };
}

export async function deleteTaskAction(args: {
  taskId: string;
  taskListId?: string;
}): Promise<{ taskId: string }> {
  const userId = await requireUserId();
  await tasksDeleteTask.execute(
    { userId },
    {
      taskId: args.taskId,
      taskListId: args.taskListId,
    },
  );
  revalidatePath("/app/calendar");
  return { taskId: args.taskId };
}
