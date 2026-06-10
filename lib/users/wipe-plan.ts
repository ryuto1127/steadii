import "server-only";

import { is, Table, type Column } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { monthlyDigests } from "@/lib/agent/digest/monthly-digests-table";

// ─── Schema-derived wipe plan ────────────────────────────────────────
//
// The user-data wipe (lib/users/wipe-data.ts) used to delete a hand-
// maintained list of tables. The schema grew past it and real third-
// party PII (correspondent names / emails / embeddings, learned facts,
// agent state) silently survived "delete my data". This module inverts
// the design: instead of an allowlist of what to delete, we keep an
// explicit allowlist of what to KEEP, and derive the delete set from the
// live drizzle schema — every pgTable with a `user_id` column that isn't
// kept is a wipe target. A regression test asserts the two sets together
// cover every user-scoped table, so a future table can't slip the wipe.
//
// Tables defined OUTSIDE lib/db/schema.ts (currently monthly_digests,
// which lives in its own module) must be registered in CANDIDATE_MODULES
// below or they won't be seen here. The regression test re-derives the
// universe the same way, so a stray external table that's neither kept
// nor registered surfaces as an uncovered table in CI.

const USER_ID_COLUMN = "user_id";

// Tables that survive a wipe. These hold the account itself, auth state,
// and the billing / audit trail that must outlive a data reset.
//
//   - users:                   the account stays; the wipe resets data,
//                               it does not delete the user.
//   - accounts / sessions /
//     verification_tokens:      NextAuth auth state. Deleting these would
//                               sign the user out / orphan their login.
//   - subscriptions / invoices: billing history (legal + support trail).
//   - processed_stripe_events:  Stripe idempotency ledger — losing it
//                               would let already-processed webhooks
//                               re-run on retry.
//   - waitlist_requests:        pre-account signups; not user content and
//                               keyed loosely (set-null FK to users).
//   - audit_log:                the record of what happened, including the
//                               wipe itself. Survives by design.
//   - usage_events:             credit / token metering for billing. Holds
//                               NO email content (model, task_type, token
//                               counts, credits only — verified), so it is
//                               kept whole for accurate lifetime metering.
export const KEEP_TABLES: ReadonlySet<string> = new Set([
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "subscriptions",
  "invoices",
  "processed_stripe_events",
  "waitlist_requests",
  "audit_log",
  "usage_events",
]);

// Modules that export pgTable definitions. lib/db/schema.ts is the bulk;
// monthly_digests is defined standalone (see its module header). Register
// any future externally-defined user-scoped table here.
const CANDIDATE_MODULES: ReadonlyArray<Record<string, unknown>> = [
  schema,
  { monthlyDigests },
];

export type UserScopedTable = {
  table: PgTable;
  tableName: string;
  userIdColumn: Column;
};

function collectUserScopedTables(): UserScopedTable[] {
  const seen = new Set<string>();
  const out: UserScopedTable[] = [];
  for (const mod of CANDIDATE_MODULES) {
    for (const value of Object.values(mod)) {
      if (!is(value, Table)) continue;
      const table = value as PgTable;
      const cfg = getTableConfig(table);
      if (seen.has(cfg.name)) continue;
      seen.add(cfg.name);
      const userIdCol = cfg.columns.find((c) => c.name === USER_ID_COLUMN);
      if (!userIdCol) continue;
      out.push({
        table,
        tableName: cfg.name,
        userIdColumn: userIdCol as unknown as Column,
      });
    }
  }
  return out;
}

// Every user-scoped table in the schema — used by the wipe plan AND by
// the regression test (which asserts each is either kept or wiped).
export const ALL_USER_SCOPED_TABLES: ReadonlyArray<UserScopedTable> =
  collectUserScopedTables();

export type WipeTarget = UserScopedTable;

// FK-ordered delete plan: children before parents. Ordering matters even
// though the users row is kept, because some wipe-set tables cascade from
// OTHER wipe-set tables (e.g. entity_links → entities, send_queue →
// agent_drafts). Deleting a parent first would cascade-delete the child
// out from under us — harmless for correctness, but the explicit child-
// first order keeps per-table delete counts truthful for the audit row.
function buildWipePlan(): WipeTarget[] {
  const candidates = ALL_USER_SCOPED_TABLES.filter(
    (t) => !KEEP_TABLES.has(t.tableName)
  );
  const byName = new Map(candidates.map((c) => [c.tableName, c]));

  // Cascade edges among wipe-set tables only. An edge child → parent means
  // child references parent ON DELETE CASCADE; child must be deleted first.
  const parentsOf = new Map<string, Set<string>>();
  for (const c of candidates) {
    const cfg = getTableConfig(c.table);
    const parents = new Set<string>();
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const parentName = getTableConfig(ref.foreignTable as PgTable).name;
      if (parentName === c.tableName) continue; // self-ref
      if (fk.onDelete !== "cascade") continue; // set-null/restrict don't gate
      if (!byName.has(parentName)) continue; // parent not in wipe set
      parents.add(parentName);
    }
    parentsOf.set(c.tableName, parents);
  }

  // Post-order DFS: emit a node after its parents, then reverse so the
  // final order is children-first. Deterministic via name-sorted seeds.
  const emitted: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const parent of parentsOf.get(name) ?? []) visit(parent);
    emitted.push(name);
  };
  for (const name of [...byName.keys()].sort()) visit(name);

  return emitted
    .reverse()
    .map((name) => byName.get(name))
    .filter((t): t is WipeTarget => t !== undefined);
}

export const WIPE_PLAN: ReadonlyArray<WipeTarget> = buildWipePlan();
