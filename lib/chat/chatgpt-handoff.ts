import "server-only";
import { db } from "@/lib/db/client";
import {
  classes as classesTable,
  mistakeNotes,
} from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { HandoffContext } from "./chatgpt-handoff-prompt";

export {
  buildHandoffPrompt,
  buildHandoffUrl,
  type HandoffContext,
} from "./chatgpt-handoff-prompt";

// Pulls the user's recent classes + weak-area notes for the ChatGPT
// handoff prompt. Capped per source so the resulting URL stays well
// under the 1.5KB byte budget enforced in `buildHandoffUrl`.
export async function buildHandoffContext(
  userId: string
): Promise<HandoffContext> {
  const [cls, ms] = await Promise.all([
    db
      .select({
        code: classesTable.code,
        name: classesTable.name,
        professor: classesTable.professor,
      })
      .from(classesTable)
      .where(
        and(
          eq(classesTable.userId, userId),
          isNull(classesTable.deletedAt)
        )
      )
      .orderBy(desc(classesTable.createdAt))
      .limit(8),
    db
      .select({ title: mistakeNotes.title })
      .from(mistakeNotes)
      .where(
        and(
          eq(mistakeNotes.userId, userId),
          isNull(mistakeNotes.deletedAt)
        )
      )
      .orderBy(desc(mistakeNotes.createdAt))
      .limit(3),
  ]);

  return {
    classes: cls.map((c) => ({
      code: c.code,
      name: c.name,
      professor: c.professor,
    })),
    recentMistakes: ms,
  };
}
