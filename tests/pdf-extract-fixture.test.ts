import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { extractPdfText } from "@/lib/syllabus/pdf";

describe("extractPdfText against a real fixture PDF", () => {
  const fixture = readFileSync(
    path.resolve(__dirname, "fixtures", "hello.pdf")
  );

  it("extracts the expected text without throwing", async () => {
    const out = await extractPdfText(fixture);
    expect(out.text.toLowerCase()).toContain("hello");
    expect(out.text.toLowerCase()).toContain("steadii");
    expect(out.numPages).toBeGreaterThanOrEqual(1);
  });

  it("does not mutate the caller's buffer (owned copy)", async () => {
    const first = fixture.readUInt8(0);
    await extractPdfText(fixture);
    expect(fixture.readUInt8(0)).toBe(first);
  });
});
