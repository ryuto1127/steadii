import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  extractSyllabus,
  fetchSyllabusUrl,
  cleanHtml,
  UnsupportedSyllabusUrlTypeError,
} from "@/lib/syllabus/extract";
import { routeSyllabusInput, isAcceptedMimeType } from "@/lib/syllabus/router";
import { extractPdfText, formatPdfWithPageMarkers } from "@/lib/syllabus/pdf";
import { checkUploadLimits } from "@/lib/billing/storage";
import {
  uploadAndRecord,
  isBlobConfigured,
  BlobNotConfiguredError,
} from "@/lib/blob/save";
import type { Syllabus } from "@/lib/syllabus/schema";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

type Verbatim = {
  fullText: string;
  sourceKind: "pdf" | "image" | "url";
  blob?: {
    blobAssetId: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
};

type OkResult = {
  syllabus: Syllabus;
  verbatim: Verbatim;
  warning?: { message: string } | null;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    enforceRateLimit(userId, "syllabus.extract", BUCKETS.syllabusExtract);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  const form = await request.formData();
  const file = form.get("file");
  const url = form.get("url");

  try {
    if (typeof url === "string" && url.length > 0) {
      return await handleUrl(userId, url);
    }

    if (file instanceof File) {
      if (!isAcceptedMimeType(file.type)) {
        return NextResponse.json(
          { error: `unsupported: ${file.type}`, code: "UNSUPPORTED_TYPE" },
          { status: 415 }
        );
      }
      return await handleFileUpload(userId, file);
    }

    return NextResponse.json(
      { error: "provide either `url` or `file`", code: "BAD_REQUEST" },
      { status: 400 }
    );
  } catch (err) {
    if (err instanceof UnsupportedSyllabusUrlTypeError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 415 }
      );
    }
    console.error("syllabus extract failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "extract_failed",
        code: "EXTRACT_FAILED",
      },
      { status: 500 }
    );
  }
}

async function handleUrl(userId: string, url: string): Promise<Response> {
  const fetched = await fetchSyllabusUrl(url);

  if (fetched.kind === "html") {
    const fullText = cleanHtml(fetched.html);
    const syllabus = await extractSyllabus({
      userId,
      source: { kind: "url", url, html: fetched.html },
    });
    syllabus.sourceUrl = syllabus.sourceUrl ?? url;
    if (!syllabus.raw || syllabus.raw.trim().length === 0) syllabus.raw = fullText;
    const verbatim: Verbatim = { fullText, sourceKind: "url" };
    return NextResponse.json({ syllabus, verbatim } satisfies OkResult);
  }

  // PDF or image URL → wrap the fetched bytes as a File and run the same
  // extraction + upload path as a direct upload.
  const mimeType = fetched.contentType.split(";")[0].trim();
  const file = new File([new Uint8Array(fetched.bytes)], fetched.filename, {
    type: mimeType,
  });
  const result = await handleFileUpload(userId, file);
  if (!result.ok) return result;

  try {
    const body = (await result.clone().json()) as OkResult;
    if (!body.syllabus.sourceUrl) body.syllabus.sourceUrl = url;
    return NextResponse.json(body);
  } catch {
    return result;
  }
}

async function handleFileUpload(userId: string, file: File): Promise<Response> {
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
          "Syllabus file uploads need Vercel Blob. Ask the administrator to set BLOB_READ_WRITE_TOKEN, or paste a URL instead.",
        code: "BLOB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let uploaded;
  try {
    uploaded = await uploadAndRecord({
      userId,
      source: "syllabus",
      file,
    });
  } catch (err) {
    if (err instanceof BlobNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "BLOB_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    console.error("syllabus blob upload failed", err);
    return NextResponse.json(
      {
        error:
          "Upload to Vercel Blob failed. If this keeps happening, check BLOB_READ_WRITE_TOKEN and network reachability.",
        code: "BLOB_UPLOAD_FAILED",
      },
      { status: 502 }
    );
  }

  if (file.type.startsWith("image/")) {
    routeSyllabusInput({
      kind: "image",
      mimeType: file.type,
      sizeBytes: file.size,
    });
    const syllabus = await extractSyllabus({
      userId,
      source: { kind: "image", url: uploaded.url, mimeType: file.type },
    });
    const fullText = syllabus.raw ?? "";
    const verbatim: Verbatim = {
      fullText,
      sourceKind: "image",
      blob: uploaded,
    };
    return NextResponse.json({
      syllabus,
      verbatim,
      warning: "warning" in limitCheck ? limitCheck.warning : null,
    } satisfies OkResult);
  }

  if (file.type === "application/pdf") {
    const pdf = await extractPdfText(bytes);
    const pageMarked = formatPdfWithPageMarkers(pdf.pages) || pdf.text;
    routeSyllabusInput({
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: file.size,
      pageCount: pdf.numPages,
    });
    const syllabus: Syllabus = await extractSyllabus({
      userId,
      source: { kind: "pdf_text", text: pdf.text || "(empty PDF)" },
    });
    if (!syllabus.raw || syllabus.raw.trim().length === 0) {
      syllabus.raw = pageMarked;
    }
    const verbatim: Verbatim = {
      fullText: pageMarked,
      sourceKind: "pdf",
      blob: uploaded,
    };
    return NextResponse.json({
      syllabus,
      verbatim,
      warning: "warning" in limitCheck ? limitCheck.warning : null,
    } satisfies OkResult);
  }

  return NextResponse.json(
    { error: `unsupported: ${file.type}`, code: "UNSUPPORTED_TYPE" },
    { status: 415 }
  );
}
