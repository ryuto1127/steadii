import { describe, expect, it, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const instances: Array<{ data: unknown }> = [];
  class FakePDFParse {
    data: unknown;
    constructor(opts: { data: unknown }) {
      this.data = opts.data;
      instances.push(this);
    }
    async getText() {
      return { text: "mock syllabus body", total: 7 };
    }
    async destroy() {}
  }
  return { PDFParse: FakePDFParse, instances };
});

vi.mock("pdf-parse", () => ({ PDFParse: hoist.PDFParse, default: {} }));

import { extractPdfText } from "@/lib/syllabus/pdf";

describe("extractPdfText", () => {
  it("dynamically imports pdf-parse and returns parsed text + page count", async () => {
    const buf = Buffer.from("%PDF-1.4 stub");
    const out = await extractPdfText(buf);
    expect(out.text).toBe("mock syllabus body");
    expect(out.numPages).toBe(7);
    expect(hoist.instances).toHaveLength(1);
  });

  it("passes the buffer into PDFParse as Uint8Array", async () => {
    const buf = Buffer.from([37, 80, 68, 70]);
    await extractPdfText(buf);
    const data = hoist.instances[hoist.instances.length - 1].data as Uint8Array;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([37, 80, 68, 70]);
  });
});
