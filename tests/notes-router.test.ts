import { describe, expect, it } from "vitest";
import {
  isAcceptedNotesMimeType,
  routeNotesInput,
} from "@/lib/notes/router";

describe("isAcceptedNotesMimeType", () => {
  it("accepts the documented PDF + image mime types", () => {
    expect(isAcceptedNotesMimeType("application/pdf")).toBe(true);
    expect(isAcceptedNotesMimeType("image/png")).toBe(true);
    expect(isAcceptedNotesMimeType("image/jpeg")).toBe(true);
    expect(isAcceptedNotesMimeType("image/gif")).toBe(true);
    expect(isAcceptedNotesMimeType("image/webp")).toBe(true);
  });

  it("rejects everything else, including office formats and svg", () => {
    expect(isAcceptedNotesMimeType("application/msword")).toBe(false);
    expect(isAcceptedNotesMimeType("text/plain")).toBe(false);
    expect(isAcceptedNotesMimeType("image/svg+xml")).toBe(false);
    expect(isAcceptedNotesMimeType("")).toBe(false);
  });
});

describe("routeNotesInput", () => {
  it("routes images to vision", () => {
    expect(
      routeNotesInput({ kind: "image", mimeType: "image/png", sizeBytes: 1000 })
    ).toBe("vision");
  });

  // Brief Q4 + decision in router.ts: handwritten PDFs always need vision
  // because pdf-parse returns nothing on a scanned page. PR 1 ships image
  // path only; the route returns PDF_NO_TEXT_LAYER for scanned PDFs and
  // documents the rasterization follow-up.
  it("routes PDFs to vision regardless of page count", () => {
    expect(
      routeNotesInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 200_000,
        pageCount: 1,
      })
    ).toBe("vision");
    expect(
      routeNotesInput({
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 5_000_000,
        pageCount: 25,
      })
    ).toBe("vision");
  });
});
