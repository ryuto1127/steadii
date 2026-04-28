import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

export type PdfTextResult = {
  text: string;
  numPages: number;
  pages: Array<{ num: number; text: string }>;
};

// unpdf bundles a serverless-friendly pdfjs build. Unlike pdf-parse v2 +
// pdfjs-dist v4 (which crashes on Vercel with "DOMMatrix is not defined"
// because vanilla pdfjs assumes browser APIs), unpdf ships its own pdfjs
// fork patched for Node / serverless runtimes — no polyfills required.
export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const owned = new Uint8Array(buffer.byteLength);
  owned.set(buffer);
  const pdf = await getDocumentProxy(owned);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const perPage = Array.isArray(text) ? text : [text];
  const pages = perPage.map((t, i) => ({ num: i + 1, text: t ?? "" }));
  const merged = pages.map((p) => p.text.trim()).filter(Boolean).join("\n\n");
  return {
    text: merged,
    numPages: totalPages,
    pages,
  };
}

export function formatPdfWithPageMarkers(pages: PdfTextResult["pages"]): string {
  if (!pages.length) return "";
  return pages
    .map((p) => `=== Page ${p.num} ===\n${p.text.trim()}`)
    .join("\n\n");
}
