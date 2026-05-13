import "server-only";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
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
//
// engineer-48 — lifecycle-aware. Expired facts (expires_at < now()) are
// excluded; decayed facts (decay_half_life_days set, untouched for ≥4
// half-lives so weighted confidence < 0.0625) are also dropped. The
// pure scoring helpers are exported so the settings page + cron can
// display the same view the prompt sees.

export const TOP_USER_FACTS_LIMIT = 12;

export type UserFactForPrompt = {
  id: string;
  fact: string;
  category: UserFactCategory | null;
};

// Threshold below which a decaying fact gets dropped entirely. 4
// half-lives = 6.25% remaining confidence — past this point keeping
// the row in the prompt costs more than it informs.
const DECAY_DROP_THRESHOLD = 0.0625;

export function decayedConfidence(args: {
  baseConfidence: number | null;
  decayHalfLifeDays: number | null;
  reviewedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  now: Date;
}): number {
  const base = args.baseConfidence ?? 1;
  if (!args.decayHalfLifeDays || args.decayHalfLifeDays <= 0) return base;
  // Anchor decay to the most recent confirmation signal: reviewedAt
  // (cron / user re-confirm) wins over lastUsedAt (prompt injection)
  // wins over createdAt (initial save).
  const anchor =
    args.reviewedAt ?? args.lastUsedAt ?? args.createdAt;
  const ms = Math.max(0, args.now.getTime() - anchor.getTime());
  const days = ms / (24 * 60 * 60 * 1000);
  const halfLives = days / args.decayHalfLifeDays;
  return base * Math.pow(0.5, halfLives);
}

export async function loadTopUserFacts(
  userId: string,
  limit: number = TOP_USER_FACTS_LIMIT,
  now: Date = new Date()
): Promise<UserFactForPrompt[]> {
  // Pull a wider window than `limit` so the post-decay filter still has
  // a healthy candidate slate when some rows are dropped for decay.
  const FETCH_OVERSHOOT = 3;
  const rows = await db
    .select({
      id: userFacts.id,
      fact: userFacts.fact,
      category: userFacts.category,
      confidence: userFacts.confidence,
      decayHalfLifeDays: userFacts.decayHalfLifeDays,
      reviewedAt: userFacts.reviewedAt,
      lastUsedAt: userFacts.lastUsedAt,
      createdAt: userFacts.createdAt,
    })
    .from(userFacts)
    .where(
      and(
        eq(userFacts.userId, userId),
        isNull(userFacts.deletedAt),
        // Skip hard-expired rows. NULL expiresAt = no expiry, always live.
        or(isNull(userFacts.expiresAt), gt(userFacts.expiresAt, now))
      )
    )
    // NULLS LAST so freshly-created rows (lastUsedAt=now) outrank stale
    // rows that haven't been touched since creation. createdAt is the
    // tie-breaker. Drizzle exposes desc() but the NULLS LAST modifier
    // needs raw sql.
    .orderBy(sql`${userFacts.lastUsedAt} DESC NULLS LAST`, desc(userFacts.createdAt))
    .limit(limit * FETCH_OVERSHOOT);

  // Apply decay filter in-memory — pgvector-style math via raw SQL is
  // overkill for a 12*3 row slate. Drops only the rows whose decayed
  // confidence has collapsed below DECAY_DROP_THRESHOLD; everything
  // else (no-decay rows, or rows still above threshold) passes through.
  const live = rows.filter((r) => {
    const c = decayedConfidence({
      baseConfidence: r.confidence,
      decayHalfLifeDays: r.decayHalfLifeDays,
      reviewedAt: r.reviewedAt,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      now,
    });
    return c >= DECAY_DROP_THRESHOLD;
  });

  return live.slice(0, limit).map((r) => ({
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
