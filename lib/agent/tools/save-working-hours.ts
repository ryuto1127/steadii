import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hhmmToMinutes } from "../preferences";
import type { ToolExecutor } from "./types";

// engineer-54 — chat-side effector for the user's working/meeting-
// available window. Persists to users.preferences.workingHoursLocal
// (JSONB; no schema migration). Used by the SLOT FEASIBILITY CHECK +
// COUNTER-PROPOSAL PATTERN sections of the system prompt to gate slot
// acceptance and counter-window framing.
//
// Auto-save (no confirmation): this is a user-volunteered preference,
// not a destructive action. Confirming again would feel like
// paperwork. The chat UI surfaces a one-line "saved working hours:
// 9:00–22:00 in your local TZ" so the action is visible. Override later
// is one more save_working_hours call away — the upsert merges over
// the existing preference key.
//
// α schema: simple non-overnight window (start < end). Overnight
// (22:00–06:00) support is post-α — at α scale all users are students
// on a normal day schedule, so a single window covers the case.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const args = z.object({
  start: z
    .string()
    .regex(HHMM, "start must be HH:MM 24h, e.g. 09:00"),
  end: z.string().regex(HHMM, "end must be HH:MM 24h, e.g. 22:00"),
});

export type SaveWorkingHoursArgs = z.input<typeof args>;

export type SaveWorkingHoursResult = {
  start: string;
  end: string;
};

export const saveWorkingHours: ToolExecutor<
  SaveWorkingHoursArgs,
  SaveWorkingHoursResult
> = {
  schema: {
    name: "save_working_hours",
    description:
      "Save the user's working/meeting-available window. Call when the user states their availability (e.g. '9 AM to 10 PM Pacific') or answers your own ask in the SLOT FEASIBILITY CHECK flow. Persists to users.preferences.workingHoursLocal; the agent reads it back via USER_WORKING_HOURS in the next turn's context block. Auto-saves without confirmation — this is a low-stakes preference, not a destructive action. α scope: simple non-overnight only (start < end). If the user says '9 AM to 9 AM' or any range that crosses midnight, ask them to split it into two windows and save the larger one for now.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description:
            "Start time in HH:MM 24h, user's profile TZ. e.g. '09:00'.",
        },
        end: {
          type: "string",
          description:
            "End time in HH:MM 24h, user's profile TZ. e.g. '22:00'. Must be after start (non-overnight only at α).",
        },
      },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const startMin = hhmmToMinutes(parsed.start);
    const endMin = hhmmToMinutes(parsed.end);
    if (!(startMin < endMin)) {
      throw new Error(
        `Invalid working hours range: start=${parsed.start} end=${parsed.end}. start must be strictly before end (overnight windows like 22:00→06:00 are deferred post-α; ask the user to specify the dominant daytime window for now).`
      );
    }

    const [row] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    const next = {
      ...(row?.preferences ?? {}),
      workingHoursLocal: { start: parsed.start, end: parsed.end },
    };
    await db
      .update(users)
      .set({ preferences: next, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    await db.insert(auditLog).values({
      userId: ctx.userId,
      action: "working_hours_saved",
      toolName: "save_working_hours",
      resourceType: "user_preference",
      resourceId: "workingHoursLocal",
      result: "success",
      detail: { start: parsed.start, end: parsed.end },
    });

    return { start: parsed.start, end: parsed.end };
  },
};

export const SAVE_WORKING_HOURS_TOOLS = [saveWorkingHours];
