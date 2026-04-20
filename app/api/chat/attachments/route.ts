import { NextResponse, type NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { messages, messageAttachments, chats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const ACCEPTED = new Map<string, "image" | "pdf">([
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
  ["application/pdf", "pdf"],
]);

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const form = await request.formData();
  const file = form.get("file");
  const chatId = form.get("chatId");
  if (!(file instanceof File) || typeof chatId !== "string") {
    return NextResponse.json({ error: "file and chatId required" }, { status: 400 });
  }
  const kind = ACCEPTED.get(file.type);
  if (!kind) {
    return NextResponse.json({ error: `unsupported: ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) {
    return NextResponse.json({ error: "chat not found" }, { status: 404 });
  }

  const [msg] = await db
    .insert(messages)
    .values({ chatId, role: "user", content: "" })
    .returning({ id: messages.id });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "blob storage not configured (BLOB_READ_WRITE_TOKEN)" },
      { status: 500 }
    );
  }

  const uploaded = await put(`steadii/${userId}/${msg.id}-${file.name}`, file, {
    access: "public",
    contentType: file.type,
  });

  const [attachment] = await db
    .insert(messageAttachments)
    .values({
      messageId: msg.id,
      kind,
      url: uploaded.url,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    })
    .returning();

  return NextResponse.json({ messageId: msg.id, attachment });
}
