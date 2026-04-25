import "server-only";
import { db } from "@/lib/db/client";
import { auditLog, classes } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ClassColorEnum } from "@/lib/db/schema";

export const classSaveSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).nullish(),
  term: z.string().max(100).nullish(),
  professor: z.string().max(200).nullish(),
  color: z
    .enum(["blue", "green", "orange", "purple", "red", "gray", "brown", "pink"])
    .nullish(),
});

export type ClassSaveInput = z.infer<typeof classSaveSchema>;

export async function createClass(args: {
  userId: string;
  input: ClassSaveInput;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(classes)
    .values({
      userId: args.userId,
      name: args.input.name,
      code: args.input.code ?? null,
      term: args.input.term ?? null,
      professor: args.input.professor ?? null,
      color: (args.input.color as ClassColorEnum | null | undefined) ?? null,
    })
    .returning({ id: classes.id });

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "class.create",
    resourceType: "class",
    resourceId: row.id,
    result: "success",
    detail: { name: args.input.name },
  });

  return { id: row.id };
}

export async function updateClass(args: {
  userId: string;
  classId: string;
  input: Partial<ClassSaveInput> & { status?: "active" | "archived" };
}): Promise<{ id: string } | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (args.input.name !== undefined) set.name = args.input.name;
  if (args.input.code !== undefined) set.code = args.input.code;
  if (args.input.term !== undefined) set.term = args.input.term;
  if (args.input.professor !== undefined) set.professor = args.input.professor;
  if (args.input.color !== undefined) set.color = args.input.color;
  if (args.input.status !== undefined) set.status = args.input.status;

  const [row] = await db
    .update(classes)
    .set(set)
    .where(
      and(
        eq(classes.id, args.classId),
        eq(classes.userId, args.userId),
        isNull(classes.deletedAt)
      )
    )
    .returning({ id: classes.id });

  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "class.update",
    resourceType: "class",
    resourceId: row.id,
    result: "success",
    detail: { fields: Object.keys(set).filter((k) => k !== "updatedAt") },
  });
  return row;
}

export async function softDeleteClass(args: {
  userId: string;
  classId: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .update(classes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(classes.id, args.classId),
        eq(classes.userId, args.userId),
        isNull(classes.deletedAt)
      )
    )
    .returning({ id: classes.id });
  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "class.delete",
    resourceType: "class",
    resourceId: row.id,
    result: "success",
  });
  return row;
}
