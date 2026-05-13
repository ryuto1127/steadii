import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userFacts, type UserFactCategory } from "@/lib/db/schema";

// engineer-47 — read-side helpers for user_facts. The chat orchestrator
// (lib/agent/context.ts) calls loadTopUserFacts at session start to
// splice the most recently-used facts into the system prompt. The
// agentic L2 user-message builder uses the same data via runAgenticL2.
//
// Top-N is capped at 12 to keep the prompt cost predictable — at α
// volume a user accumulating >12 distinct facts is rare, and the
// oldest-touched drop off naturally via the lastUsedAt ordering.

export const TOP_USER_FACTS_LIMIT = 12;

export type UserFactForPrompt = {
  id: string;
  fact: string;
  category: UserFactCategory | null;
};

export async function loadTopUserFacts(
  userId: string,
  limit: number = TOP_USER_FACTS_LIMIT
): Promise<UserFactForPrompt[]> {
  const rows = await db
    .select({
      id: userFacts.id,
      fact: userFacts.fact,
      category: userFacts.category,
    })
    .from(userFacts)
    .where(and(eq(userFacts.userId, userId), isNull(userFacts.deletedAt)))
    // NULLS LAST so freshly-created rows (lastUsedAt=now) outrank stale
    // rows that haven't been touched since creation. createdAt is the
    // tie-breaker. Drizzle exposes desc() but the NULLS LAST modifier
    // needs raw sql.
    .orderBy(sql`${userFacts.lastUsedAt} DESC NULLS LAST`, desc(userFacts.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    fact: r.fact,
    category: r.category ?? null,
  }));
}

// Render the prompt block. Returns "" when the list is empty so callers
// can append unconditionally without an extra newline.
export function renderUserFactsBlock(facts: UserFactForPrompt[]): string {
  if (facts.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    "USER FACTS (things Steadii has learned about you across past sessions):"
  );
  for (const f of facts) {
    const tag = f.category ? `[${f.category}] ` : "";
    lines.push(`- ${tag}${f.fact}`);
  }
  lines.push("");
  lines.push(
    "Use these as ambient context. Don't re-ask things already covered. If a fact looks stale or wrong, call save_user_fact with the corrected version (the soft-unique index upserts cleanly)."
  );
  return lines.join("\n");
}

// engineer-47 — Part 4. Bump lastUsedAt on facts that were injected
// into the prompt for this turn. Cheap UPDATE keyed by (userId, fact)
// — fact uniqueness is enforced by the soft-unique partial index.
// Called fire-and-forget from the orchestrator post-turn.
export async function markUserFactsUsed(
  userId: string,
  factsThatAppeared: string[]
): Promise<void> {
  if (factsThatAppeared.length === 0) return;
  await db
    .update(userFacts)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(userFacts.userId, userId),
        isNull(userFacts.deletedAt),
        inArray(userFacts.fact, factsThatAppeared)
      )
    );
}
