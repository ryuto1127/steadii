import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("lib/blob/save.ts", () => {
  const src = readFileSync(
    path.resolve(__dirname, "..", "lib/blob/save.ts"),
    "utf8"
  );

  it("uses access: 'public' for the Vercel Blob put call", () => {
    expect(src).toMatch(/access:\s*"public"/);
  });

  it("documents the α-period public-access trade-off", () => {
    expect(src).toMatch(/Public access/);
    expect(src).toMatch(/Notion/); // Notion file block rationale
    expect(src).toMatch(/cryptographically random/);
  });
});
