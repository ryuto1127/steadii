"use server";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

export async function createChatAction() {
  const userId = await requireUserId();
  const [row] = await db
    .insert(chats)
    .values({ userId })
    .returning({ id: chats.id });
  redirect(`/app/chat/${row.id}`);
}

export async function renameChatAction(formData: FormData) {
  const userId = await requireUserId();
  const id = formData.get("id");
  const title = formData.get("title");
  if (typeof id !== "string" || typeof title !== "string") {
    throw new Error("Invalid input");
  }
  await db
    .update(chats)
    .set({ title: title.trim() || null, updatedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
  revalidatePath(`/app/chat/${id}`);
  revalidatePath(`/app/chat`);
}

export async function deleteChatAction(formData: FormData) {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid input");
  await db
    .update(chats)
    .set({ deletedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
  redirect("/app/chat");
}

export async function postUserMessageAction(formData: FormData) {
  const userId = await requireUserId();
  const chatId = formData.get("chatId");
  const content = formData.get("content");
  if (typeof chatId !== "string" || typeof content !== "string") {
    throw new Error("Invalid input");
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) throw new Error("Chat not found");

  await db.insert(messagesTable).values({
    chatId,
    role: "user",
    content: content.trim(),
  });

  await db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, chatId));

  redirect(`/app/chat/${chatId}?stream=1`);
}
