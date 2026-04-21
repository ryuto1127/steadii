import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { messages, messageAttachments, chats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { checkUploadLimits } from "@/lib/billing/storage";
import {
  uploadAndRecord,
  isBlobConfigured,
  BlobNotConfiguredError,
} from "@/lib/blob/save";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

const ACCEPTED = new Map<string, "image" | "pdf">([
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
  ["application/pdf", "pdf"],
]);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthenticated", code: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  try {
    enforceRateLimit(userId, "chat.attachment", BUCKETS.chatAttachment);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  if (!isBlobConfigured()) {
    return NextResponse.json(
      {
        error:
          "Image and PDF uploads are disabled — BLOB_READ_WRITE_TOKEN isn't configured.",
        code: "BLOB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const chatId = form.get("chatId");
  if (!(file instanceof File) || typeof chatId !== "string") {
    return NextResponse.json(
      { error: "file and chatId required", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }
  const kind = ACCEPTED.get(file.type);
  if (!kind) {
    return NextResponse.json(
      { error: `unsupported: ${file.type}`, code: "UNSUPPORTED_TYPE" },
      { status: 415 }
    );
  }

  const check = await checkUploadLimits(userId, file.size);
  if (!check.ok) {
    return NextResponse.json(
      {
        error: check.message,
        code: check.code,
        plan: check.plan,
        limitBytes: check.limitBytes,
        actualBytes: check.actualBytes,
      },
      { status: 413 }
    );
  }

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) {
    return NextResponse.json(
      { error: "chat not found", code: "CHAT_NOT_FOUND" },
      { status: 404 }
    );
  }

  const [msg] = await db
    .insert(messages)
    .values({ chatId, role: "user", content: "" })
    .returning({ id: messages.id });

  let uploaded;
  try {
    uploaded = await uploadAndRecord({
      userId,
      source: "chat_attachment",
      file,
    });
  } catch (err) {
    if (err instanceof BlobNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "BLOB_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    console.error("blob upload failed", err);
    return NextResponse.json(
      {
        error:
          "Upload to Vercel Blob failed. If this keeps happening, ask the administrator to check BLOB_READ_WRITE_TOKEN and network reachability.",
        code: "BLOB_UPLOAD_FAILED",
      },
      { status: 502 }
    );
  }

  const [attachment] = await db
    .insert(messageAttachments)
    .values({
      messageId: msg.id,
      blobAssetId: uploaded.blobAssetId,
      kind,
      url: uploaded.url,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
    })
    .returning();

  return NextResponse.json({
    messageId: msg.id,
    attachment,
    warning: "warning" in check ? check.warning : null,
  });
}
