import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog, userFacts, type UserFactCategory } from "@/lib/db/schema";
import { lifecycleForCategory } from "@/lib/agent/user-facts-lifecycle";
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
//
// engineer-48 — lifecycle aware. The agent can override the per-category
// defaults via expiresInDays / decayHalfLifeDays. On a re-save, the
// lifecycle is re-computed from the (possibly updated) category so a
// schedule fact re-confirmed today gets its 4-month clock reset.

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
  // engineer-48 — optional agent-driven overrides. If unset the
  // category default applies. expiresInDays is a relative-from-now
  // convenience so the LLM doesn't have to compute absolute dates.
  expiresInDays: z.number().int().positive().max(3650).optional(),
  decayHalfLifeDays: z.number().int().positive().max(3650).optional(),
});

// 2026-05-12 sparring fix — use z.input (not z.infer / z.output) because
// `category` and `source` have .default() values; the OUTPUT type (used
// by z.infer) marks them required, but at the boundary (LLM tool call
// JSON or unit-test call site) they're optional and the .parse() inside
// execute() fills the defaults. Mismatch broke typecheck on the test.
export type SaveUserFactArgs = z.input<typeof args>;

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
      "Save a persistent fact about the user that should be remembered across chat sessions. Call this when the user reveals something Steadii should know for the long term — their schedule, communication style, location/timezone (if they say it explicitly), academic situation, personal preferences (e.g. 'don't notify me at night'). Do NOT save transient state ('I'm tired today'), passwords/secrets, or anything they specifically said is private. The fact is shown back to the user in Settings — write it in their app locale, first-person ('私は…' / 'I…') is fine. The system auto-assigns a lifecycle from category (schedule expires 4mo, academic 1yr, location never, etc.); only set expiresInDays / decayHalfLifeDays if you know the fact has a non-default shelf life.",
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
        expiresInDays: {
          type: "number",
          description:
            "Optional hard expiry in days from now. Override the category default when you know this fact has a specific shelf life (e.g. 'I'm in Tokyo this summer' → ~90 days).",
        },
        decayHalfLifeDays: {
          type: "number",
          description:
            "Optional confidence half-life in days. Use for soft-decaying preferences (communication style, mood-adjacent prefs). Default applies for communication_style.",
        },
      },
      required: ["fact"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const now = new Date();
    const baseLifecycle = lifecycleForCategory(parsed.category, now);
    // Agent overrides win over category defaults; if neither is set,
    // the column stays NULL (no expiry / no decay).
    const expiresAt =
      parsed.expiresInDays != null
        ? new Date(now.getTime() + parsed.expiresInDays * 24 * 60 * 60 * 1000)
        : baseLifecycle.expiresAt;
    const decayHalfLifeDays =
      parsed.decayHalfLifeDays ?? baseLifecycle.decayHalfLifeDays;
    const nextReviewAt = baseLifecycle.nextReviewAt;

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
        // engineer-48 — lifecycle columns. reviewedAt = now() because
        // a re-save is a re-confirmation: the user (or the agent
        // re-inferring) is telling us the fact is current.
        expiresAt,
        nextReviewAt,
        reviewedAt: now,
        decayHalfLifeDays,
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
          expiresAt,
          nextReviewAt,
          reviewedAt: now,
          decayHalfLifeDays,
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
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        nextReviewAt: nextReviewAt ? nextReviewAt.toISOString() : null,
        decayHalfLifeDays,
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
