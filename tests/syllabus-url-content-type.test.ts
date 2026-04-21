import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ OPENAI_API_KEY: "x" }) }));
vi.mock("@/lib/integrations/openai/client", () => ({ openai: () => ({}) }));
vi.mock("@/lib/agent/usage", () => ({ recordUsage: async () => {} }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

import {
  classifyFetchedContentType,
  filenameFromUrl,
  fetchSyllabusUrl,
  UnsupportedSyllabusUrlTypeError,
} from "@/lib/syllabus/extract";

describe("classifyFetchedContentType", () => {
  it("routes text/html and charset variants", () => {
    expect(classifyFetchedContentType("text/html; charset=utf-8")).toBe("html");
    expect(classifyFetchedContentType("text/plain")).toBe("html");
    expect(classifyFetchedContentType("application/xhtml+xml")).toBe("html");
  });

  it("routes application/pdf", () => {
    expect(classifyFetchedContentType("application/pdf")).toBe("pdf");
    expect(classifyFetchedContentType("Application/PDF")).toBe("pdf");
  });

  it("routes image/* mime types", () => {
    expect(classifyFetchedContentType("image/png")).toBe("image");
    expect(classifyFetchedContentType("image/jpeg")).toBe("image");
  });

  it("returns null for unknown types", () => {
    expect(classifyFetchedContentType("application/octet-stream")).toBeNull();
    expect(classifyFetchedContentType("")).toBeNull();
  });
});

describe("filenameFromUrl", () => {
  it("keeps a filename-with-extension from the URL path", () => {
    expect(filenameFromUrl("https://x.edu/courses/csc101.pdf", "pdf")).toBe(
      "csc101.pdf"
    );
  });

  it("falls back to hostname-based name when the path has no filename", () => {
    const name = filenameFromUrl("https://example.edu/syllabus", "pdf");
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name).toContain("example-edu");
  });

  it("handles malformed URL input", () => {
    expect(filenameFromUrl("not a url", "png")).toBe("syllabus.png");
  });
});

describe("fetchSyllabusUrl routing", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns { kind: 'html' } for an HTML response", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("<html><body>course info</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
    const out = await fetchSyllabusUrl("https://x.edu/syllabus");
    expect(out.kind).toBe("html");
    if (out.kind === "html") expect(out.html).toContain("course info");
  });

  it("returns { kind: 'pdf', bytes, filename } for application/pdf", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(bytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })
    );
    const out = await fetchSyllabusUrl("https://x.edu/csc101.pdf");
    expect(out.kind).toBe("pdf");
    if (out.kind === "pdf") {
      expect(out.bytes[0]).toBe(0x25);
      expect(out.filename).toBe("csc101.pdf");
    }
  });

  it("returns { kind: 'image', bytes, filename } for image/png", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(bytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );
    const out = await fetchSyllabusUrl("https://x.edu/cover.png");
    expect(out.kind).toBe("image");
    if (out.kind === "image") expect(out.filename).toBe("cover.png");
  });

  it("throws UnsupportedSyllabusUrlTypeError for unknown content-type", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );
    await expect(fetchSyllabusUrl("https://x.edu/f")).rejects.toBeInstanceOf(
      UnsupportedSyllabusUrlTypeError
    );
  });
});
