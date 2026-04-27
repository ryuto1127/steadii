import "server-only";
import { z } from "zod";
import type { ToolExecutor } from "./types";
import { classSaveSchema, createClass } from "@/lib/classes/save";

const args = classSaveSchema;

export const classCreate: ToolExecutor<
  z.infer<typeof args>,
  { id: string; name: string }
> = {
  schema: {
    name: "class_create",
    description:
      "Create a new academic class in Steadii's Postgres store. Use this when the student says things like 'create a class for Math II' / '物理2の授業を作って' — DO NOT use notion_create_page or notion_create_row for class creation. Classes are the canonical Steadii entity for academic context (mistake notes, syllabi, assignments all attach to a class). Only `name` is required; the student can fill the other fields later via the UI. If the student gave you a course code (e.g. CSC108, MAT135), pass it as `code`. If they gave a term (Spring 2026, 2026年春学期), pass it as `term`. Color picks one of: blue, green, orange, purple, red, gray, brown, pink — pick a sensible distinct one if the student didn't specify.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        code: { type: ["string", "null"] },
        term: { type: ["string", "null"] },
        professor: { type: ["string", "null"] },
        color: {
          type: ["string", "null"],
          enum: [
            "blue",
            "green",
            "orange",
            "purple",
            "red",
            "gray",
            "brown",
            "pink",
            null,
          ],
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const { id } = await createClass({ userId: ctx.userId, input: parsed });
    return { id, name: parsed.name };
  },
};

export const CLASSES_TOOLS = [classCreate];
