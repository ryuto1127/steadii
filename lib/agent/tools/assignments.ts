// engineer-44 — `assignments_create` chat tool.
//
// Lets the student dictate "英作文の課題、来週水曜まで" / "Bio test next
// Friday" / "add an assignment for Math due Dec 5" and get a row
// inserted in the `assignments` table. Class linkage is best-effort —
// we match the optional `classHint` against the user's classes by name
// or code (case-insensitive); if no match, classId stays null and the
// student can attach it later via the UI.

import "server-only";
import { z } from "zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes } from "@/lib/db/schema";
import { createAssignment } from "@/lib/assignments/save";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import { parseDueDate } from "@/lib/assignments/parse-due";
import type { ToolExecutor } from "./types";

const argsSchema = z.object({
  title: z.string().min(1).max(300),
  due: z.string().min(1),
  classHint: z.string().nullish(),
  priority: z.enum(["low", "medium", "high"]).nullish(),
  notes: z.string().nullish(),
});

type Args = z.infer<typeof argsSchema>;

type Result = {
  id: string;
  title: string;
  dueAt: string;
  classId: string | null;
  classMatched: boolean;
};

export const assignmentsCreate: ToolExecutor<Args, Result> = {
  schema: {
    name: "assignments_create",
    description:
      "Create a new assignment in Steadii with a due date and optional class linkage. Use this when the student says things like '英作文の課題、来週水曜まで' / 'I have a Bio test next Friday' / 'add an assignment for Math due Dec 5'. Date parsing: accepts ISO (2026-05-20 or 2026-05-20T17:00), relative ('today', 'tomorrow', 'in 3 days', 'next Friday', '来週水曜', '3日後'), or absolute JP/slash ('12月5日', '12/5'). Pass the raw natural-language phrase as-is in `due` — the tool resolves it server-side. When the student mentions a class, pass its name or code via `classHint` and the tool resolves it against the user's existing classes; no match → classId stays null. Default status is 'not_started', source is 'chat'.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        due: { type: "string" },
        classHint: { type: ["string", "null"] },
        priority: {
          type: ["string", "null"],
          enum: ["low", "medium", "high", null],
        },
        notes: { type: ["string", "null"] },
      },
      required: ["title", "due"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = argsSchema.parse(rawArgs);

    const tz = (await getUserTimezone(ctx.userId)) ?? FALLBACK_TZ;
    const parsed = parseDueDate(args.due, { timezone: tz });
    if (!parsed.ok) {
      throw new Error(
        `Could not parse due date "${args.due}": ${parsed.reason}. Pass an ISO date (2026-05-20), a relative phrase ('next Friday', '来週水曜'), or absolute (12月5日 / 12/5).`
      );
    }

    let classId: string | null = null;
    let classMatched = false;
    if (args.classHint && args.classHint.trim().length > 0) {
      const hint = args.classHint.trim();
      classId = await resolveClassId(ctx.userId, hint);
      classMatched = classId !== null;
    }

    const { id } = await createAssignment({
      userId: ctx.userId,
      input: {
        title: args.title,
        classId,
        dueAt: parsed.date.toISOString(),
        status: "not_started",
        priority: args.priority ?? null,
        notes: args.notes ?? null,
        source: "chat",
      },
    });

    return {
      id,
      title: args.title,
      dueAt: parsed.date.toISOString(),
      classId,
      classMatched,
    };
  },
};

async function resolveClassId(
  userId: string,
  hint: string
): Promise<string | null> {
  const lower = hint.toLowerCase();
  const rows = await db
    .select({
      id: classes.id,
      createdAt: classes.createdAt,
    })
    .from(classes)
    .where(
      and(
        eq(classes.userId, userId),
        isNull(classes.deletedAt),
        eq(classes.status, "active"),
        or(
          sql`lower(${classes.name}) = ${lower}`,
          sql`lower(${classes.code}) = ${lower}`,
          sql`lower(${classes.name}) like ${`%${lower}%`}`,
          sql`lower(${classes.code}) like ${`%${lower}%`}`
        )
      )
    )
    .orderBy(desc(classes.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

export const ASSIGNMENTS_TOOLS = [assignmentsCreate];
