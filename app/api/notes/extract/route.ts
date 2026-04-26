import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { extractHandwrittenNote } from "@/lib/notes/extract";
import { isAcceptedNotesMimeType, routeNotesInput } from "@/lib/notes/router";
import { extractPdfText, formatPdfWithPageMarkers } from "@/lib/syllabus/pdf";
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
import { BillingQuotaExceededError } from "@/lib/billing/credits";

export const runtime = "nodejs";

export type NotesExtractOk = {
  markdown: string;
  pagesProcessed: number;
  blob: {
    blobAssetId: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
  warning?: { message: string } | null;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    enforceRateLimit(userId, "notes.extract", BUCKETS.notesExtract);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "provide `file` in multipart/form-data", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  if (!isAcceptedNotesMimeType(file.type)) {
    return NextResponse.json(
      { error: `unsupported: ${file.type}`, code: "UNSUPPORTED_TYPE" },
      { status: 415 }
    );
  }

  const limitCheck = await checkUploadLimits(userId, file.size);
  if (!limitCheck.ok) {
    return NextResponse.json(
      {
        error: limitCheck.message,
        code: limitCheck.code,
        plan: limitCheck.plan,
        limitBytes: limitCheck.limitBytes,
        actualBytes: limitCheck.actualBytes,
      },
      { status: 413 }
    );
  }

  if (!isBlobConfigured()) {
    return NextResponse.json(
      {
        error:
          "Handwritten note uploads need Vercel Blob. Ask the administrator to set BLOB_READ_WRITE_TOKEN.",
        code: "BLOB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  let uploaded;
  try {
    uploaded = await uploadAndRecord({
      userId,
      source: "handwritten_note",
      file,
    });
  } catch (err) {
    if (err instanceof BlobNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "BLOB_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    console.error("notes blob upload failed", err);
    return NextResponse.json(
      {
        error:
          "Upload to Vercel Blob failed. If this keeps happening, check BLOB_READ_WRITE_TOKEN and network reachability.",
        code: "BLOB_UPLOAD_FAILED",
      },
      { status: 502 }
    );
  }

  try {
    if (file.type.startsWith("image/")) {
      routeNotesInput({
        kind: "image",
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const result = await extractHandwrittenNote({
        userId,
        source: { kind: "image", url: uploaded.url, mimeType: file.type },
      });
      return NextResponse.json({
        markdown: result.markdown,
        pagesProcessed: result.pagesProcessed,
        blob: uploaded,
        warning: "warning" in limitCheck ? limitCheck.warning : null,
      } satisfies NotesExtractOk);
    }

    // application/pdf path. α scope ships text-layer extraction only —
    // scanned/handwritten PDFs without an embedded text layer require the
    // user to re-upload as page images. Per-page rasterization to vision
    // is a documented follow-up (see docs/handoffs/phase7-w-notes-*).
    const bytes = Buffer.from(await file.arrayBuffer());
    const pdf = await extractPdfText(bytes);
    const pageMarked = formatPdfWithPageMarkers(pdf.pages) || pdf.text;
    const usableText = pageMarked.trim();

    if (usableText.length < 32) {
      return NextResponse.json(
        {
          error:
            "This PDF has no extractable text — it looks scanned or handwritten. Please upload it as page images (PNG/JPEG) instead.",
          code: "PDF_NO_TEXT_LAYER",
          blob: uploaded,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      markdown: pageMarked,
      pagesProcessed: pdf.numPages || 1,
      blob: uploaded,
      warning: "warning" in limitCheck ? limitCheck.warning : null,
    } satisfies NotesExtractOk);
  } catch (err) {
    if (err instanceof BillingQuotaExceededError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          balance: err.balance,
        },
        { status: 402 }
      );
    }
    console.error("notes extract failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "extract_failed",
        code: "EXTRACT_FAILED",
      },
      { status: 500 }
    );
  }
}
