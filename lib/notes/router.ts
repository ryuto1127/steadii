// Phase 7 W-Notes — input routing for handwritten / scanned notes.
//
// Mirrors lib/syllabus/router shape so the API route stays familiar, but
// with one rule flipped: handwritten PDFs ALWAYS need vision, never the
// pdf-parse text path. Scanned pages have no extractable text layer, so
// pdf-parse returns "" or noise; routing them through `pdf_text` would
// silently produce empty markdown.

export type NotesInput =
  | { kind: "image"; mimeType: string; sizeBytes: number }
  | {
      kind: "pdf";
      mimeType: "application/pdf";
      sizeBytes: number;
      pageCount?: number;
    };

export type NotesRoute = "vision" | "pdf_text_with_vision_fallback";

export function routeNotesInput(input: NotesInput): NotesRoute {
  if (input.kind === "image") return "vision";
  // PDFs: prefer vision because handwritten/scanned PDFs have no usable
  // text layer. Reserve the text-with-fallback path for rare cases of
  // typed PDFs uploaded through this flow by mistake — the vision call
  // handles those equally well, so we only split if a future cost
  // optimization makes it worth the branch.
  return "vision";
}

export function isAcceptedNotesMimeType(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/gif" ||
    mime === "image/webp"
  );
}
