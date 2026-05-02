import "server-only";
import { z } from "zod";
import { createOfficeHoursRequest } from "@/lib/agent/office-hours/scheduler";
import type { ToolExecutor } from "./types";

// Wave 3.3 — orchestrator tool that lets the user trigger an office-
// hours scheduling flow via voice / chat / command palette.
//
// "Schedule with my MAT223 prof about chapter 4"
// "Prof Tanaka と office hours、ch4 について"
//
// The tool composes the flow but the actual scheduling decision (slot
// pick, send email, create event) happens in the Type A → Type B queue
// cards, NOT in the chat. The tool's job is to put the request on
// the user's Home queue.

const SchemaArgs = z.object({
  classRefHint: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Free-form class reference: class code (MAT223), class name, or 'my MAT223 prof'. The orchestrator forwards what the user said."
    ),
  topic: z
    .string()
    .max(200)
    .nullable()
    .describe(
      "Optional topic the user wants to discuss (e.g. 'ch4', 'midterm prep'). Used to filter the compiled question list."
    ),
});

export const scheduleOfficeHoursTool: ToolExecutor<
  z.infer<typeof SchemaArgs>,
  {
    status: "created" | "no_class_match" | "no_office_hours";
    requestId: string | null;
    message: string;
  }
> = {
  schema: {
    name: "schedule_office_hours",
    description:
      "Start an office-hours scheduling flow for a named class. Pulls slots from the syllabus, compiles relevant questions, and surfaces a Type A card on Home for the user to pick a slot.",
    mutability: "write",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        classRefHint: {
          type: "string",
          description:
            "Free-form class reference: class code (MAT223), class name, or 'my MAT223 prof'.",
        },
        topic: {
          type: ["string", "null"],
          description:
            "Optional topic (e.g. 'ch4', 'midterm prep'). Used to filter the compiled question list.",
        },
      },
      required: ["classRefHint", "topic"],
    },
  },
  async execute(ctx, args) {
    const parsed = SchemaArgs.parse(args);
    const result = await createOfficeHoursRequest({
      userId: ctx.userId,
      classRefHint: parsed.classRefHint,
      topic: parsed.topic,
    });
    if (result.status === "no_class_match") {
      return {
        status: result.status,
        requestId: null,
        message: `I couldn't find a class matching "${parsed.classRefHint}". Try the class code (e.g. MAT223) or full name.`,
      };
    }
    if (result.status === "no_office_hours") {
      return {
        status: result.status,
        requestId: null,
        message:
          "I don't have structured office hours for that class yet. Add the prof's office hours to the syllabus and try again.",
      };
    }
    return {
      status: result.status,
      requestId: result.id,
      message:
        "Office hours request prepared on Home — pick a slot and Steadii will draft the email.",
    };
  },
};

export const OFFICE_HOURS_TOOLS = [scheduleOfficeHoursTool];
