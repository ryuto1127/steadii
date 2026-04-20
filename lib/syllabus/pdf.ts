import "server-only";

export type PdfTextResult = {
  text: string;
  numPages: number;
  pages: Array<{ num: number; text: string }>;
};

// pdf-parse v2 ships PDFParse as a class in both CJS and ESM, but Next.js 15
// bundlers sometimes route it through a layer that leaves `PDFParse` only
// reachable as `.default` or `.default.PDFParse`. Defensive import resolves
// it either way and fails loudly if neither is present.
//
// Separate from the import issue: pdfjs-dist (pdf-parse's engine) mutates
// the backing ArrayBuffer it receives. Node's Buffer pool is shared across
// allocations, so handing pdfjs `buffer.buffer` can lead to
// "Object.defineProperty called on non-object" as pdfjs tries to attach
// state to an object it doesn't own. Always copy into a fresh, owned
// Uint8Array.
export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const mod = (await import("pdf-parse")) as unknown as Record<string, unknown>;
  const resolved = resolvePdfParseExport(mod);
  if (!resolved) {
    throw new Error(
      "pdf-parse: PDFParse export not found — check the installed version or downgrade to pdf-parse@1.x"
    );
  }

  if (resolved.kind === "v2") {
    const PDFParseCtor = resolved.PDFParse;
    const owned = new Uint8Array(buffer.byteLength);
    owned.set(buffer);
    const parser = new PDFParseCtor({ data: owned });
    try {
      const result = await parser.getText();
      const pages = (result.pages ?? []).map((p: { num: number; text: string }) => ({
        num: p.num,
        text: p.text ?? "",
      }));
      return {
        text: result.text ?? "",
        numPages: result.total ?? pages.length,
        pages,
      };
    } finally {
      try {
        await parser.destroy();
      } catch {
        // ignore
      }
    }
  }

  // v1 (or v1-shaped) fallback: the module is a callable function returning
  // { text, numpages } and does not expose per-page text.
  const pdfParseFn = resolved.pdfParse;
  const owned = new Uint8Array(buffer.byteLength);
  owned.set(buffer);
  const out = (await pdfParseFn(Buffer.from(owned))) as {
    text: string;
    numpages: number;
  };
  const text = out.text ?? "";
  return {
    text,
    numPages: out.numpages ?? 0,
    pages: text
      ? [{ num: 1, text }] // no per-page split on v1; treat as one page
      : [],
  };
}

type ResolvedPdfParse =
  | {
      kind: "v2";
      PDFParse: new (opts: { data: Uint8Array }) => {
        getText(): Promise<{
          text: string;
          total: number;
          pages?: Array<{ num: number; text: string }>;
        }>;
        destroy(): Promise<void>;
      };
    }
  | {
      kind: "v1";
      pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number }>;
    };

export function resolvePdfParseExport(
  mod: Record<string, unknown> | null | undefined
): ResolvedPdfParse | null {
  if (!mod) return null;
  const candidates = [
    (mod as { PDFParse?: unknown }).PDFParse,
    (mod as { default?: { PDFParse?: unknown } }).default?.PDFParse,
  ];
  for (const c of candidates) {
    if (typeof c === "function") {
      return {
        kind: "v2",
        PDFParse: c as ResolvedPdfParse extends { PDFParse: infer C } ? C : never,
      };
    }
  }
  // v1 shape: module itself (or .default) is a callable function.
  if (typeof mod === "function") {
    return {
      kind: "v1",
      pdfParse: mod as (data: Buffer) => Promise<{ text: string; numpages: number }>,
    };
  }
  const asDefault = (mod as { default?: unknown }).default;
  if (typeof asDefault === "function") {
    return {
      kind: "v1",
      pdfParse: asDefault as (
        data: Buffer
      ) => Promise<{ text: string; numpages: number }>,
    };
  }
  return null;
}

export function formatPdfWithPageMarkers(pages: PdfTextResult["pages"]): string {
  if (!pages.length) return "";
  return pages
    .map((p) => `=== Page ${p.num} ===\n${p.text.trim()}`)
    .join("\n\n");
}
