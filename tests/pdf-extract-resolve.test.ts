import { describe, expect, it } from "vitest";
import { resolvePdfParseExport } from "@/lib/syllabus/pdf";

describe("resolvePdfParseExport", () => {
  it("resolves v2 export shape (module.PDFParse)", () => {
    const fakePDFParse = function () {};
    const out = resolvePdfParseExport({ PDFParse: fakePDFParse });
    expect(out?.kind).toBe("v2");
  });

  it("resolves v2 nested under default (module.default.PDFParse)", () => {
    const fakePDFParse = function () {};
    const out = resolvePdfParseExport({ default: { PDFParse: fakePDFParse } });
    expect(out?.kind).toBe("v2");
  });

  it("resolves v1 callable default", () => {
    const fakeFn = async () => ({ text: "", numpages: 0 });
    const out = resolvePdfParseExport({ default: fakeFn });
    expect(out?.kind).toBe("v1");
  });

  it("returns null when no useful export is found", () => {
    expect(resolvePdfParseExport({ other: 1 })).toBeNull();
    expect(resolvePdfParseExport(null)).toBeNull();
  });
});
