import "server-only";

export type PdfTextResult = { text: string; numPages: number };

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  // pdf-parse@2 ships a proper `PDFParse` class API. Dynamic-import it inside
  // the function so bundlers don't try to pre-resolve its heavy transitive
  // graph (pdfjs-dist) on unrelated routes.
  const { PDFParse } = await import("pdf-parse");

  const parser = new PDFParse({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  });
  try {
    const result = await parser.getText();
    return { text: result.text ?? "", numPages: result.total ?? 0 };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
