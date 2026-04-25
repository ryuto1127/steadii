import "server-only";
import { db } from "@/lib/db/client";
import { assignments, auditLog } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

export const assignmentSaveSchema = z.object({
  title: z.string().min(1).max(300),
  classId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
  status: z.enum(["not_started", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).nullish(),
  notes: z.string().nullish(),
  source: z.enum(["manual", "classroom", "chat"]).optional(),
  externalId: z.string().nullish(),
});

export type AssignmentSaveInput = z.infer<typeof assignmentSaveSchema>;

export async function createAssignment(args: {
  userId: string;
  input: AssignmentSaveInput;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(assignments)
    .values({
      userId: args.userId,
      classId: args.input.classId ?? null,
      title: args.input.title,
      dueAt: args.input.dueAt ? new Date(args.input.dueAt) : null,
      status: args.input.status ?? "not_started",
      priority: args.input.priority ?? null,
      notes: args.input.notes ?? null,
      source: args.input.source ?? "manual",
      externalId: args.input.externalId ?? null,
    })
    .returning({ id: assignments.id });

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "assignment.create",
    resourceType: "assignment",
    resourceId: row.id,
    result: "success",
    detail: {
      title: args.input.title,
      classId: args.input.classId ?? null,
      source: args.input.source ?? "manual",
    },
  });

  return { id: row.id };
}

export async function updateAssignment(args: {
  userId: string;
  assignmentId: string;
  input: Partial<
    Omit<AssignmentSaveInput, "source" | "externalId">
  >;
}): Promise<{ id: string } | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (args.input.title !== undefined) set.title = args.input.title;
  if (args.input.classId !== undefined) set.classId = args.input.classId;
  if (args.input.dueAt !== undefined) {
    set.dueAt = args.input.dueAt ? new Date(args.input.dueAt) : null;
  }
  if (args.input.status !== undefined) set.status = args.input.status;
  if (args.input.priority !== undefined) set.priority = args.input.priority;
  if (args.input.notes !== undefined) set.notes = args.input.notes;

  const [row] = await db
    .update(assignments)
    .set(set)
    .where(
      and(
        eq(assignments.id, args.assignmentId),
        eq(assignments.userId, args.userId),
        isNull(assignments.deletedAt)
      )
    )
    .returning({ id: assignments.id });

  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "assignment.update",
    resourceType: "assignment",
    resourceId: row.id,
    result: "success",
    detail: { fields: Object.keys(set).filter((k) => k !== "updatedAt") },
  });
  return row;
}

export async function softDeleteAssignment(args: {
  userId: string;
  assignmentId: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .update(assignments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(assignments.id, args.assignmentId),
        eq(assignments.userId, args.userId),
        isNull(assignments.deletedAt)
      )
    )
    .returning({ id: assignments.id });
  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "assignment.delete",
    resourceType: "assignment",
    resourceId: row.id,
    result: "success",
  });
  return row;
}
