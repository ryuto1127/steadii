import "server-only";
import { db } from "@/lib/db/client";
import { chats as chatsTable, classes as classesTable } from "@/lib/db/schema";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  formatClassesBlock,
  formatTopicsBlock,
  type VoiceUserContext,
} from "./user-context-format";

const MAX_CLASSES = 10;
const MAX_RECENT_CHATS = 5;

export async function fetchVoiceUserContext(
  userId: string
): Promise<VoiceUserContext> {
  const [classRows, chatRows] = await Promise.all([
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
          eq(classesTable.status, "active"),
          isNull(classesTable.deletedAt)
        )
      )
      .orderBy(desc(classesTable.updatedAt))
      .limit(MAX_CLASSES),
    db
      .select({ title: chatsTable.title })
      .from(chatsTable)
      .where(
        and(
          eq(chatsTable.userId, userId),
          isNull(chatsTable.deletedAt),
          isNotNull(chatsTable.title)
        )
      )
      .orderBy(desc(chatsTable.updatedAt))
      .limit(MAX_RECENT_CHATS),
  ]);

  return {
    classesBlock: formatClassesBlock(classRows),
    topicsBlock: formatTopicsBlock(chatRows),
  };
}

export {
  buildVoiceContextSystemMessage,
  type VoiceUserContext,
} from "./user-context-format";
