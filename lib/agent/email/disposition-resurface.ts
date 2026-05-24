import "server-only";

// 2026-05-24 (PR 3) — re-surface sweep for Type B Draft cards that the
// user explicitly スキップ'd. Skipping is "not now, ask me later"; the
// contract is that the card re-appears after 24 hours. This sweep does
// the flip: any row with `disposition='skipped' AND skipped_at < now()
// - 24h` gets flipped back to `disposition='active'` with `skipped_at`
// cleared, so the next queue read picks it up.
//
// Why a separate sub-sweep (not merged into draft-superseded): the two
// have different cadences (30-min on draft-superseded is too coarse for
// a 24h re-surface? No — actually 30-min is fine, but the source
// table is different — draft-superseded queries Gmail per-row; this
// one is a pure DB update with no external dependency). Keeping them
// separate keeps the failure modes orthogonal: a Gmail outage doesn't
// block re-surfaces, and a DB hiccup here doesn't slow the Gmail probe.
//
// Idempotency: the WHERE clause is exact (`disposition='skipped'`), so
// re-running on the same window is a no-op once flipped. `skipped_at`
// is explicitly cleared so a subsequent re-skip is timestamped fresh.

import * as Sentry from "@sentry/nextjs";
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { agentDrafts } from "@/lib/db/schema";

export type DispositionResurfaceResult = {
  resurfaced: number;
};

// 24h in milliseconds. Exported so tests can use the exact same
// constant without hard-coding.
export const RESURFACE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runDispositionResurfaceSweep(args: {
  // Injected for tests; defaults to Date.now in production.
  now?: Date;
}): Promise<DispositionResurfaceResult> {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - RESURFACE_WINDOW_MS);

  try {
    const rows = await db
      .update(agentDrafts)
      .set({
        disposition: "active",
        skippedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentDrafts.disposition, "skipped"),
          isNotNull(agentDrafts.skippedAt),
          lt(agentDrafts.skippedAt, cutoff),
        ),
      )
      .returning({ id: agentDrafts.id });

    return { resurfaced: rows.length };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "disposition_resurface", phase: "sweep" },
    });
    throw err;
  }
}
