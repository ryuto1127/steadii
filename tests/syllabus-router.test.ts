import { describe, expect, it } from "vitest";
import { routeSyllabusInput, isAcceptedMimeType } from "@/lib/syllabus/router";

describe("routeSyllabusInput", () => {
  it("URL → url_fetch", () => {
    expect(routeSyllabusInput({ kind: "url", url: "https://x" })).toBe("url_fetch");
  });

  it("image → vision", () => {
    expect(
      routeSyllabusInput({ kind: "image", mimeType: "image/png", sizeBytes: 200_000 })
    ).toBe("vision");
  });

  it("small PDF (≤5 pages) → vision", () => {
    expect(
      routeSyllabusInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 500_000,
        pageCount: 3,
      })
    ).toBe("vision");
    expect(
      routeSyllabusInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 500_000,
        pageCount: 5,
      })
    ).toBe("vision");
  });

  it("large PDF (>5 pages) → pdf_text_with_vision_fallback", () => {
    expect(
      routeSyllabusInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_500_000,
        pageCount: 12,
      })
    ).toBe("pdf_text_with_vision_fallback");
  });

  it("PDF with unknown page count → pdf_text_with_vision_fallback", () => {
    expect(
      routeSyllabusInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_500_000,
      })
    ).toBe("pdf_text_with_vision_fallback");
  });
});

describe("isAcceptedMimeType", () => {
  it("accepts PDF + common images", () => {
    for (const m of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(isAcceptedMimeType(m)).toBe(true);
    }
  });
  it("rejects other types", () => {
    expect(isAcceptedMimeType("text/html")).toBe(false);
    expect(isAcceptedMimeType("application/zip")).toBe(false);
    expect(isAcceptedMimeType("")).toBe(false);
  });
});
