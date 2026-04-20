import { z } from "zod";

export const syllabusSchema = z.object({
  courseName: z.string().nullable().optional(),
  courseCode: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
  instructor: z.string().nullable().optional(),
  officeHours: z.string().nullable().optional(),
  grading: z.string().nullable().optional(),
  attendance: z.string().nullable().optional(),
  textbooks: z.string().nullable().optional(),
  schedule: z
    .array(
      z.object({
        date: z.string().nullable().optional(),
        topic: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  sourceUrl: z.string().url().nullable().optional(),
  raw: z.string().nullable().optional(),
});

export type Syllabus = z.infer<typeof syllabusSchema>;
