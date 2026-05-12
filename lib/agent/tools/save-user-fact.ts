import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog, userFacts, type UserFactCategory } from "@/lib/db/schema";
import type { ToolExecutor } from "./types";

// engineer-47 — chat-side effector for persisting a user-self fact the
// agent should remember across sessions. Mirrors the shape of
// convert-timezone.ts (zod-validated args + ToolExecutor) and reuses the
// generic audit_log + onConflictDoUpdate pattern from
// persistAgenticSideEffects (lib/agent/email/l2.ts).
//
// Soft-unique index (user_id, fact) WHERE deleted_at IS NULL ensures
// re-saving the same sentence upserts: lastUsedAt bumps, deletedAt
// clears. Strict string match — semantic dedup is a deliberate non-goal
// (LLM call would be another spend; the index is cheap).

const CATEGORIES = [
  "schedule",
  "communication_style",
  "location_timezone",
  "academic",
  "personal_pref",
  "other",
] as const;

const args = z.object({
  fact: z.string().trim().min(1).max(500),
  category: z.enum(CATEGORIES).default("other"),
  source: z.enum(["user_explicit", "agent_inferred"]).default("agent_inferred"),
});

export type SaveUserFactArgs = z.infer<typeof args>;

export type SaveUserFactResult = {
  id: string;
  fact: string;
  category: UserFactCategory;
  source: "user_explicit" | "agent_inferred";
};

export const saveUserFact: ToolExecutor<
  SaveUserFactArgs,
  SaveUserFactResult
> = {
  schema: {
    name: "save_user_fact",
    description:
      "Save a persistent fact about the user that should be remembered across chat sessions. Call this when the user reveals something Steadii should know for the long term — their schedule, communication style, location/timezone (if they say it explicitly), academic situation, personal preferences (e.g. 'don't notify me at night'). Do NOT save transient state ('I'm tired today'), passwords/secrets, or anything they specifically said is private. The fact is shown back to the user in Settings — write it in their app locale, first-person ('私は…' / 'I…') is fine.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description:
            "The sentence to remember, 1-500 chars, in the user's locale, first-person.",
        },
        category: {
          type: "string",
          enum: [...CATEGORIES],
          description:
            "Coarse bucket: 'schedule' (working hours / availability), 'communication_style' (tone preferences), 'location_timezone' (where they are), 'academic' (school / year / major), 'personal_pref' (notification + behavior prefs), 'other'.",
        },
        source: {
          type: "string",
          enum: ["user_explicit", "agent_inferred"],
          description:
            "'user_explicit' when the user said 'remember that…' or similar. 'agent_inferred' when you picked it up heuristically from their message.",
        },
      },
      required: ["fact"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const now = new Date();
    const [row] = await db
      .insert(userFacts)
      .values({
        userId: ctx.userId,
        fact: parsed.fact,
        category: parsed.category,
        source: parsed.source,
        // Confidence only meaningful for agent_inferred; left null on
        // user_explicit since the user's word stands.
        confidence: parsed.source === "agent_inferred" ? 0.8 : null,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [userFacts.userId, userFacts.fact],
        // Re-save → bump lastUsedAt, clear any prior soft-delete, and
        // adopt the latest category/source the agent picked. A user
        // re-confirming a previously inferred fact promotes it to
        // user_explicit; the inverse direction is rare in practice.
        set: {
          category: parsed.category,
          source: parsed.source,
          confidence:
            parsed.source === "agent_inferred" ? 0.8 : null,
          lastUsedAt: now,
          deletedAt: null,
        },
      })
      .returning({
        id: userFacts.id,
        fact: userFacts.fact,
        category: userFacts.category,
        source: userFacts.source,
      });

    await db.insert(auditLog).values({
      userId: ctx.userId,
      action: "user_fact_saved",
      toolName: "save_user_fact",
      resourceType: "user_fact",
      resourceId: row.id,
      result: "success",
      detail: {
        fact: parsed.fact,
        category: parsed.category,
        source: parsed.source,
      },
    });

    return {
      id: row.id,
      fact: row.fact,
      category: (row.category ?? "other") as UserFactCategory,
      source: row.source,
    };
  },
};

export const SAVE_USER_FACT_TOOLS = [saveUserFact];
