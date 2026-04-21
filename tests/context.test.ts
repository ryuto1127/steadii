import { describe, expect, it, vi } from "vitest";
import { serializeContextForPrompt } from "@/lib/agent/serialize-context";

describe("serializeContextForPrompt", () => {
  it("marks disconnected users clearly", () => {
    const out = serializeContextForPrompt({
      timezone: "America/Vancouver",
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
      timezone: "America/Vancouver",
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

  it("emits a Time block anchored on the user's timezone with an offset", () => {
    const out = serializeContextForPrompt({
      timezone: "America/Vancouver",
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
    expect(out).toMatch(/^# Time/);
    expect(out).toMatch(/America\/Vancouver/);
    // Now must carry a real offset, not Z — Vancouver is -07:00 (PDT) or -08:00 (PST).
    expect(out).toMatch(/Now: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \(America\/Vancouver\)/);
    expect(out).toMatch(/Today \(user-local\): \d{4}-\d{2}-\d{2} \(\w+\)/);
    expect(out).not.toMatch(/Now: [^\n]*Z /);
  });

  it("falls back to UTC when timezone is null (and warns)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = serializeContextForPrompt({
      timezone: null,
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
    expect(out).toMatch(/\(UTC\)/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
