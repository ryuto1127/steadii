import { describe, expect, it } from "vitest";

// The DB-driven fetcher (`fetchVoiceUserContext`) is exercised in
// integration. Here we test the pure message-assembly helper, imported
// from the format-only sibling file so the DB client doesn't load.
import {
  buildVoiceContextSystemMessage,
  formatClassesBlock,
  formatTopicsBlock,
} from "@/lib/voice/user-context-format";

describe("buildVoiceContextSystemMessage", () => {
  it("returns null when both blocks are empty", () => {
    expect(buildVoiceContextSystemMessage({})).toBeNull();
    expect(
      buildVoiceContextSystemMessage({ classesBlock: undefined, topicsBlock: undefined })
    ).toBeNull();
  });

  it("includes only the classes block when topics are empty", () => {
    const out = buildVoiceContextSystemMessage({
      classesBlock: "Classes:\n- MAT223 — Linear Algebra I",
    });
    expect(out).toContain("USER ACADEMIC CONTEXT");
    expect(out).toContain("MAT223");
    expect(out).not.toContain("Recent chat topics");
  });

  it("includes only the topics block when classes are empty", () => {
    const out = buildVoiceContextSystemMessage({
      topicsBlock: "Recent chat topics: midterm review",
    });
    expect(out).toContain("USER ACADEMIC CONTEXT");
    expect(out).toContain("midterm review");
    expect(out).not.toContain("Classes:");
  });

  it("joins classes + topics with the canonical USER ACADEMIC CONTEXT header", () => {
    const out = buildVoiceContextSystemMessage({
      classesBlock: "Classes:\n- MAT223 — Linear Algebra I (Prof. Smith)",
      topicsBlock: "Recent chat topics: midterm review, lab 4 submission",
    });
    expect(out!.startsWith("USER ACADEMIC CONTEXT")).toBe(true);
    expect(out).toContain("MAT223");
    expect(out).toContain("Prof. Smith");
    expect(out).toContain("Recent chat topics");
  });
});

describe("formatClassesBlock", () => {
  it("returns undefined for an empty list", () => {
    expect(formatClassesBlock([])).toBeUndefined();
  });

  it("formats `<code> — <name> (Prof. <professor>)` when all fields are set", () => {
    const out = formatClassesBlock([
      { code: "MAT223", name: "Linear Algebra I", professor: "Smith" },
    ]);
    expect(out).toBe("Classes:\n- MAT223 — Linear Algebra I (Prof. Smith)");
  });

  it("omits the professor parenthetical when the field is null/empty", () => {
    const out = formatClassesBlock([
      { code: "CSC110", name: "Intro to CS", professor: null },
      { code: "BIO120", name: "Adaptation & Biodiversity", professor: "  " },
    ]);
    expect(out).toContain("- CSC110 — Intro to CS");
    expect(out).toContain("- BIO120 — Adaptation & Biodiversity");
    expect(out).not.toMatch(/Prof\. /);
  });

  it("falls back to just `<name>` when the code is missing", () => {
    const out = formatClassesBlock([
      { code: null, name: "Independent Study", professor: "Jones" },
    ]);
    expect(out).toBe("Classes:\n- Independent Study (Prof. Jones)");
  });
});

describe("formatTopicsBlock", () => {
  it("returns undefined when no chats have titles", () => {
    expect(formatTopicsBlock([])).toBeUndefined();
    expect(
      formatTopicsBlock([{ title: null }, { title: "  " }])
    ).toBeUndefined();
  });

  it("joins non-empty titles with a comma", () => {
    expect(
      formatTopicsBlock([
        { title: "midterm review" },
        { title: null },
        { title: " lab 4 submission " },
      ])
    ).toBe("Recent chat topics: midterm review, lab 4 submission");
  });
});
