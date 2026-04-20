export type SyllabusInput =
  | { kind: "image"; mimeType: string; sizeBytes: number }
  | { kind: "pdf"; mimeType: "application/pdf"; sizeBytes: number; pageCount?: number }
  | { kind: "url"; url: string };

export type SyllabusRoute =
  | "vision"
  | "pdf_text"
  | "pdf_text_with_vision_fallback"
  | "url_fetch";

const SMALL_PDF_MAX_PAGES = 5;

export function routeSyllabusInput(input: SyllabusInput): SyllabusRoute {
  if (input.kind === "url") return "url_fetch";
  if (input.kind === "image") return "vision";
  if (input.kind === "pdf") {
    if (input.pageCount !== undefined && input.pageCount <= SMALL_PDF_MAX_PAGES) {
      return "vision";
    }
    return "pdf_text_with_vision_fallback";
  }
  return "pdf_text";
}

export function isAcceptedMimeType(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/gif" ||
    mime === "image/webp"
  );
}
