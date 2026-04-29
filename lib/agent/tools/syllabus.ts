import "server-only";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syllabi } from "@/lib/db/schema";
import type { ToolExecutor } from "./types";

const args = z.object({
  syllabusId: z.string().uuid(),
});

export const readSyllabusFullText: ToolExecutor<
  z.infer<typeof args>,
  {
    syllabusId: string;
    found: boolean;
    fullText: string;
    truncated: boolean;
  }
> = {
  schema: {
    name: "read_syllabus_full_text",
    description:
      "Fetch the verbatim full text preserved when a syllabus was saved (the original PDF text with page markers, cleaned URL content, or Vision transcription). Use this to answer questions that aren't covered by the structured syllabus properties — grading rubric wording, exact attendance rules, specific dates from the schedule, etc.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: { syllabusId: { type: "string" } },
      required: ["syllabusId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const [row] = await db
      .select({ fullText: syllabi.fullText })
      .from(syllabi)
      .where(
        and(
          eq(syllabi.id, parsed.syllabusId),
          eq(syllabi.userId, ctx.userId),
          isNull(syllabi.deletedAt)
        )
      )
      .limit(1);

    if (!row) {
      return {
        syllabusId: parsed.syllabusId,
        found: false,
        fullText: "",
        truncated: false,
      };
    }

    const fullText = row.fullText ?? "";
    const MAX_CHARS = 60_000;
    const truncated = fullText.length > MAX_CHARS;
    return {
      syllabusId: parsed.syllabusId,
      found: fullText.length > 0,
      fullText: truncated ? fullText.slice(0, MAX_CHARS) : fullText,
      truncated,
    };
  },
};

export const SYLLABUS_TOOLS = [readSyllabusFullText];
