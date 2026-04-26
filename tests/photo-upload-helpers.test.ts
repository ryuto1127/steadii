import { describe, expect, it } from "vitest";
import { deriveTitleFromFile } from "@/components/mistakes/photo-upload-button";

describe("deriveTitleFromFile", () => {
  it("strips a single extension and rewrites separators to spaces", () => {
    expect(deriveTitleFromFile("calc-ch5-page2.png")).toBe("calc ch5 page2");
    expect(deriveTitleFromFile("integration_by_parts.pdf")).toBe(
      "integration by parts"
    );
  });

  it("falls back to the original filename when stripping leaves nothing", () => {
    expect(deriveTitleFromFile(".pdf")).toBe(".pdf");
  });

  it("preserves spaces and Japanese characters", () => {
    expect(deriveTitleFromFile("数学のノート.jpeg")).toBe("数学のノート");
    expect(deriveTitleFromFile("My Notes.pdf")).toBe("My Notes");
  });
});
