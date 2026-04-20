import { describe, expect, it } from "vitest";
import { syllabusSchema } from "@/lib/syllabus/schema";

describe("syllabusSchema", () => {
  it("accepts a fully populated syllabus", () => {
    const parsed = syllabusSchema.parse({
      courseName: "Intro CS",
      courseCode: "CSC101H1",
      term: "Fall 2026",
      instructor: "Dr. X",
      officeHours: "Tue 2–4pm",
      grading: "30% mid, 70% final",
      attendance: "Mandatory",
      textbooks: "CLRS",
      schedule: [{ date: "2026-09-07", topic: "Intro" }],
      sourceUrl: "https://example.com/syllabus",
      raw: null,
    });
    expect(parsed.courseCode).toBe("CSC101H1");
  });

  it("accepts a syllabus with mostly nulls", () => {
    const parsed = syllabusSchema.parse({
      courseName: null,
      courseCode: null,
      term: null,
      instructor: null,
      officeHours: null,
      grading: null,
      attendance: null,
      textbooks: null,
      schedule: [],
      sourceUrl: null,
      raw: null,
    });
    expect(parsed.schedule).toEqual([]);
  });

  it("rejects invalid URL", () => {
    expect(() =>
      syllabusSchema.parse({
        courseName: null,
        courseCode: null,
        term: null,
        instructor: null,
        officeHours: null,
        grading: null,
        attendance: null,
        textbooks: null,
        schedule: [],
        sourceUrl: "not-a-url",
        raw: null,
      })
    ).toThrow();
  });
});
