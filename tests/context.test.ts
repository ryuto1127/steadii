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

  it("renders academicCounts when present", () => {
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
      academicCounts: {
        classes: 5,
        assignmentsActive: 3,
        mistakeNotes: 12,
        syllabi: 4,
      },
    });
    expect(out).toMatch(
      /Academic store \(Postgres\): 5 classes, 3 active tasks, 12 mistake notes, 4 syllabi\./
    );
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
    expect(out).toMatch(/^# USER CONTEXT/);
    expect(out).toMatch(/\n# Time\n/);
    expect(out).toMatch(/America\/Vancouver/);
    // Now must carry a real offset, not Z — Vancouver is -07:00 (PDT) or -08:00 (PST).
    expect(out).toMatch(/Now: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \(America\/Vancouver\)/);
    expect(out).toMatch(/Today \(user-local\): \d{4}-\d{2}-\d{2} \(\w+\)/);
    expect(out).not.toMatch(/Now: [^\n]*Z /);
  });

  it("emits a USER CONTEXT block with TZ, abbreviation, locale, and current local time", () => {
    const out = serializeContextForPrompt({
      timezone: "America/Vancouver",
      locale: "ja",
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
    expect(out).toMatch(/^# USER CONTEXT/);
    // Abbreviation (PT/PDT/PST) and UTC offset both present.
    expect(out).toMatch(/Timezone: America\/Vancouver \(P[DS]?T?, UTC[+-]\d{2}:\d{2}\)/);
    expect(out).toMatch(/Current local time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
    expect(out).toMatch(/Locale: ja/);
  });

  it("USER CONTEXT defaults locale to 'en' when payload omits it", () => {
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
    expect(out).toMatch(/Locale: en/);
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

  // engineer-53 — USER_NAME injection. The system prompt's EMAIL REPLY
  // WORKFLOW MUST-rule 5 binds the agent to use the user's real name in
  // sign-offs; this is the data-side anchor that lets it.
  describe("USER_NAME injection", () => {
    it("emits a USER_NAME line with the real name when present", () => {
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
        userName: "田中 太郎",
      });
      expect(out).toMatch(/USER_NAME: 田中 太郎/);
    });

    it("emits a USER_NAME line with the unknown-fallback when null", () => {
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
        userName: null,
      });
      expect(out).toMatch(/USER_NAME: \(unknown/);
      expect(out).toMatch(/ask the user/);
      expect(out).not.toMatch(/USER_NAME: \n/);
    });

    it("falls back to the unknown-fallback when userName is empty / whitespace", () => {
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
        userName: "   ",
      });
      expect(out).toMatch(/USER_NAME: \(unknown/);
    });

    it("USER_NAME line precedes Timezone in the USER CONTEXT block", () => {
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
        userName: "Alex",
      });
      const userIdx = out.indexOf("USER_NAME:");
      const tzIdx = out.indexOf("Timezone:");
      expect(userIdx).toBeGreaterThan(-1);
      expect(tzIdx).toBeGreaterThan(-1);
      expect(userIdx).toBeLessThan(tzIdx);
    });
  });
});
