"use server";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
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
  revalidatePath(`/app/chats`);
}

export async function deleteChatAction(formData: FormData) {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid input");
  await db
    .update(chats)
    .set({ deletedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
  redirect("/app/chats");
}

export async function deleteChatFromListAction(formData: FormData) {
  const userId = await requireUserId();
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("Invalid input");
  await db
    .update(chats)
    .set({ deletedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
  revalidatePath("/app/chats");
  revalidatePath("/app");
}
