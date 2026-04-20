import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { extractSyllabus, fetchSyllabusUrl } from "@/lib/syllabus/extract";
import { routeSyllabusInput, isAcceptedMimeType } from "@/lib/syllabus/router";
import { extractPdfText } from "@/lib/syllabus/pdf";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const form = await request.formData();
  const file = form.get("file");
  const url = form.get("url");

  try {
    if (typeof url === "string" && url.length > 0) {
      const { html } = await fetchSyllabusUrl(url);
      const syllabus = await extractSyllabus({
        userId,
        source: { kind: "url", url, html },
      });
      syllabus.sourceUrl = syllabus.sourceUrl ?? url;
      return NextResponse.json({ syllabus });
    }

    if (file instanceof File) {
      if (!isAcceptedMimeType(file.type)) {
        return NextResponse.json(
          { error: `unsupported: ${file.type}` },
          { status: 415 }
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());

      if (file.type.startsWith("image/")) {
        if (!process.env.BLOB_READ_WRITE_TOKEN) {
          return NextResponse.json(
            { error: "blob storage not configured" },
            { status: 500 }
          );
        }
        const uploaded = await put(`steadii/${userId}/syllabus/${Date.now()}-${file.name}`, file, {
          access: "public",
          contentType: file.type,
        });
        const input = routeSyllabusInput({
          kind: "image",
          mimeType: file.type,
          sizeBytes: file.size,
        });
        if (input !== "vision") {
          throw new Error(`unexpected image route: ${input}`);
        }
        const syllabus = await extractSyllabus({
          userId,
          source: { kind: "image", url: uploaded.url, mimeType: file.type },
        });
        return NextResponse.json({ syllabus });
      }

      if (file.type === "application/pdf") {
        const pdf = await extractPdfText(bytes);
        const route = routeSyllabusInput({
          kind: "pdf",
          mimeType: "application/pdf",
          sizeBytes: file.size,
          pageCount: pdf.numPages,
        });
        const useVision = route === "vision";
        if (useVision) {
          // Small PDF → we'd ideally pass page images; for α, feed text if
          // present and fall back to raw text otherwise.
          const syllabus = await extractSyllabus({
            userId,
            source: pdf.text.trim()
              ? { kind: "pdf_text", text: pdf.text }
              : { kind: "raw_text", text: "(empty PDF)" },
          });
          return NextResponse.json({ syllabus });
        }
        const syllabus = await extractSyllabus({
          userId,
          source: { kind: "pdf_text", text: pdf.text },
        });
        return NextResponse.json({ syllabus });
      }
    }

    return NextResponse.json(
      { error: "provide either `url` or `file`" },
      { status: 400 }
    );
  } catch (err) {
    console.error("syllabus extract failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extract_failed" },
      { status: 500 }
    );
  }
}
