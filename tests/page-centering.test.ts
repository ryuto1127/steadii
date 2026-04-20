import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..", "app/app");

function walkPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkPageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

describe("app/app/**/page.tsx centering", () => {
  const files = walkPageFiles(APP_ROOT);

  it("discovers at least one page", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(APP_ROOT, file);
    it(`${rel}: every className with a width cap pairs it with mx-auto`, () => {
      const src = readFileSync(file, "utf8");
      // Match each className="..." substring containing max-w-* and check mx-auto.
      const re = /className="[^"]*\bmax-w-[^"\s]+[^"]*"/g;
      const matches = src.match(re) ?? [];
      for (const m of matches) {
        expect(m).toMatch(/\bmx-auto\b/);
      }
    });
  }
});
