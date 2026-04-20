import { describe, expect, it } from "vitest";
import { serializeContextForPrompt } from "@/lib/agent/serialize-context";

describe("serializeContextForPrompt", () => {
  it("marks disconnected users clearly", () => {
    const out = serializeContextForPrompt({
      notion: {
        connected: false,
        parentPageId: null,
        classesDbId: null,
        mistakesDbId: null,
        assignmentsDbId: null,
        syllabiDbId: null,
      },
      registeredResources: [],
    });
    expect(out).toMatch(/Notion connected: no/);
  });

  it("renders all 4 DB ids and registered resources", () => {
    const out = serializeContextForPrompt({
      notion: {
        connected: true,
        parentPageId: "parent",
        classesDbId: "classes",
        mistakesDbId: "mistakes",
        assignmentsDbId: "assignments",
        syllabiDbId: "syllabi",
      },
      registeredResources: [
        { kind: "database", notionId: "classes", title: "Classes" },
        { kind: "page", notionId: "extra-page", title: "Extra notes" },
      ],
    });
    expect(out).toMatch(/Classes DB: classes/);
    expect(out).toMatch(/Mistake Notes DB: mistakes/);
    expect(out).toMatch(/Assignments DB: assignments/);
    expect(out).toMatch(/Syllabi DB: syllabi/);
    expect(out).toMatch(/\[database\] Classes/);
    expect(out).toMatch(/\[page\] Extra notes/);
  });
});
