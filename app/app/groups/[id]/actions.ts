"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  groupProjectMembers,
  groupProjectTasks,
  groupProjects,
  inboxItems,
  users,
} from "@/lib/db/schema";
import {
  generateCheckInDraft,
  type CheckInDraft,
} from "@/lib/agent/groups/check-in";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

async function ensureOwns(userId: string, groupId: string) {
  const [g] = await db
    .select({ id: groupProjects.id })
    .from(groupProjects)
    .where(and(eq(groupProjects.id, groupId), eq(groupProjects.userId, userId)))
    .limit(1);
  if (!g) throw new Error("Group not found");
}

const taskInsert = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeEmail: z.string().email().nullable().optional(),
  due: z.string().datetime().nullable().optional(),
});

export async function addGroupTaskAction(
  groupId: string,
  raw: { title: string; assigneeEmail: string | null; due?: string | null }
): Promise<void> {
  const userId = await requireUserId();
  await ensureOwns(userId, groupId);
  const parsed = taskInsert.parse(raw);
  await db.insert(groupProjectTasks).values({
    groupProjectId: groupId,
    title: parsed.title,
    assigneeEmail: parsed.assigneeEmail ?? null,
    due: parsed.due ? new Date(parsed.due) : null,
  });
  revalidatePath(`/app/groups/${groupId}`);
}

export async function toggleGroupTaskDoneAction(
  taskId: string,
  done: boolean
): Promise<void> {
  const userId = await requireUserId();
  // Verify the task belongs to a group owned by the user.
  const [row] = await db
    .select({ groupId: groupProjectTasks.groupProjectId })
    .from(groupProjectTasks)
    .innerJoin(
      groupProjects,
      eq(groupProjects.id, groupProjectTasks.groupProjectId)
    )
    .where(
      and(eq(groupProjectTasks.id, taskId), eq(groupProjects.userId, userId))
    )
    .limit(1);
  if (!row) throw new Error("Task not found");
  await db
    .update(groupProjectTasks)
    .set({ doneAt: done ? new Date() : null })
    .where(eq(groupProjectTasks.id, taskId));
  revalidatePath(`/app/groups/${row.groupId}`);
}

export async function removeGroupTaskAction(taskId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ groupId: groupProjectTasks.groupProjectId })
    .from(groupProjectTasks)
    .innerJoin(
      groupProjects,
      eq(groupProjects.id, groupProjectTasks.groupProjectId)
    )
    .where(
      and(eq(groupProjectTasks.id, taskId), eq(groupProjects.userId, userId))
    )
    .limit(1);
  if (!row) throw new Error("Task not found");
  await db.delete(groupProjectTasks).where(eq(groupProjectTasks.id, taskId));
  revalidatePath(`/app/groups/${row.groupId}`);
}

export async function archiveGroupAction(groupId: string): Promise<void> {
  const userId = await requireUserId();
  await ensureOwns(userId, groupId);
  await db
    .update(groupProjects)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(groupProjects.id, groupId));
  revalidatePath("/app");
  revalidatePath(`/app/groups/${groupId}`);
}

export async function draftCheckInAction(
  groupId: string,
  memberEmail: string
): Promise<CheckInDraft> {
  const userId = await requireUserId();
  await ensureOwns(userId, groupId);

  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [group] = await db
    .select()
    .from(groupProjects)
    .where(eq(groupProjects.id, groupId))
    .limit(1);
  if (!group) throw new Error("Group not found");

  const [member] = await db
    .select()
    .from(groupProjectMembers)
    .where(
      and(
        eq(groupProjectMembers.groupProjectId, groupId),
        eq(groupProjectMembers.email, memberEmail)
      )
    )
    .limit(1);
  if (!member) throw new Error("Member not found");

  const daysSilent = member.lastRespondedAt
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - member.lastRespondedAt.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      )
    : 0;

  const recent = await db
    .select({ snippet: inboxItems.snippet, subject: inboxItems.subject })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.senderEmail, memberEmail),
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(desc(inboxItems.receivedAt))
    .limit(3);

  return generateCheckInDraft({
    userId,
    userName: user?.name?.trim().split(/\s+/)[0] ?? null,
    groupTitle: group.title,
    className: null,
    memberName: member.name,
    memberEmail: member.email,
    daysSilent,
    recentSnippets: recent
      .map((r) => `${r.subject ?? ""} :: ${r.snippet ?? ""}`.trim())
      .filter((s) => s.length > 0),
  });
}
