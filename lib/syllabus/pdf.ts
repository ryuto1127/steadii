import "server-only";

export type PdfTextResult = { text: string; numPages: number };

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const mod = await import("pdf-parse");
  const pdfParse = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> })
    .default;
  const out = await pdfParse(buffer);
  return { text: out.text ?? "", numPages: out.numpages ?? 0 };
}
