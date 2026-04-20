import "server-only";
import { put } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { blobAssets } from "@/lib/db/schema";

export type BlobSource = "chat_attachment" | "syllabus";

export type UploadedAsset = {
  blobAssetId: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function uploadAndRecord(args: {
  userId: string;
  source: BlobSource;
  file: File;
  pathPrefix?: string;
}): Promise<UploadedAsset> {
  if (!isBlobConfigured()) {
    throw new BlobNotConfiguredError();
  }

  const prefix = args.pathPrefix ?? `steadii/${args.userId}/${args.source}`;
  const path = `${prefix}/${Date.now()}-${args.file.name}`;

  const uploaded = await put(path, args.file, {
    access: "public",
    contentType: args.file.type,
  });

  const [row] = await db
    .insert(blobAssets)
    .values({
      userId: args.userId,
      source: args.source,
      url: uploaded.url,
      filename: args.file.name,
      mimeType: args.file.type,
      sizeBytes: args.file.size,
    })
    .returning({ id: blobAssets.id });

  return {
    blobAssetId: row.id,
    url: uploaded.url,
    filename: args.file.name,
    mimeType: args.file.type,
    sizeBytes: args.file.size,
  };
}

export class BlobNotConfiguredError extends Error {
  code = "BLOB_NOT_CONFIGURED" as const;
  constructor() {
    super(
      "Vercel Blob is not configured. Ask the administrator to set BLOB_READ_WRITE_TOKEN."
    );
  }
}
