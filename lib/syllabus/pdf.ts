import "server-only";

export type PdfTextResult = {
  text: string;
  numPages: number;
  pages: Array<{ num: number; text: string }>;
};

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  // pdf-parse@2 ships a proper PDFParse class API. Dynamic-import it inside
  // the function so bundlers don't pre-resolve its heavy transitive graph
  // (pdfjs-dist) on unrelated routes.
  const { PDFParse } = await import("pdf-parse");

  const parser = new PDFParse({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  });
  try {
    const result = await parser.getText();
    const pages = (result.pages ?? []).map((p) => ({
      num: p.num,
      text: p.text ?? "",
    }));
    return {
      text: result.text ?? "",
      numPages: result.total ?? pages.length,
      pages,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export function formatPdfWithPageMarkers(pages: PdfTextResult["pages"]): string {
  if (!pages.length) return "";
  return pages
    .map((p) => `=== Page ${p.num} ===\n${p.text.trim()}`)
    .join("\n\n");
}
