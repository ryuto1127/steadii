import { describe, expect, it } from "vitest";

// The wipe plan is derived from the live drizzle schema, not a hand-
// maintained list. These tests are the drift-killer: every user-scoped
// table must be either explicitly KEPT or covered by WIPE_PLAN, and the
// delete order must be FK-safe (children before parents) so the wipe
// runs without tripping a cascade constraint while the users row stays.
//
// No DB is touched — wipe-plan.ts introspects the schema at import time.

import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ALL_USER_SCOPED_TABLES,
  KEEP_TABLES,
  WIPE_PLAN,
} from "@/lib/users/wipe-plan";

describe("wipe plan — coverage", () => {
  it("every user-scoped table is either KEPT or in the WIPE_PLAN", () => {
    const wiped = new Set(WIPE_PLAN.map((t) => t.tableName));
    const covered = new Set([...wiped, ...KEEP_TABLES]);

    const uncovered = ALL_USER_SCOPED_TABLES.filter(
      (t) => !covered.has(t.tableName)
    ).map((t) => t.tableName);

    // A new user-scoped table that's neither kept nor wiped fails here —
    // forcing an explicit KEEP/WIPE decision instead of silently leaking
    // the user's data past "delete my data".
    expect(uncovered).toEqual([]);
  });

  it("KEEP and WIPE are disjoint — no table is both kept and wiped", () => {
    const overlap = WIPE_PLAN.filter((t) =>
      KEEP_TABLES.has(t.tableName)
    ).map((t) => t.tableName);
    expect(overlap).toEqual([]);
  });

  it("every WIPE_PLAN entry actually has a user_id column", () => {
    for (const target of WIPE_PLAN) {
      const cfg = getTableConfig(target.table);
      expect(cfg.columns.some((c) => c.name === "user_id")).toBe(true);
      expect(target.userIdColumn.name).toBe("user_id");
    }
  });

  it("covers the previously-leaked third-party-PII and agent-state tables", () => {
    const wiped = new Set(WIPE_PLAN.map((t) => t.tableName));
    // These were missing from the old hand-maintained wipe list — the
    // regression this PR fixes. entities / entity_links hold correspondent
    // names + emails + embeddings; the rest are learned agent state.
    for (const t of [
      "entities",
      "entity_links",
      "user_facts",
      "sender_confidence",
      "monthly_digests",
      "auto_created_calendar_events",
      "agent_confirmations",
      "agent_contact_personas",
      "event_pre_briefs",
      "task_intent_metadata",
      "agent_notifications",
      "agent_ignored_senders",
      "office_hours_requests",
      "class_office_hours",
      "group_projects",
    ]) {
      expect(wiped.has(t)).toBe(true);
    }
  });

  it("keeps billing / auth / audit tables out of the wipe", () => {
    const wiped = new Set(WIPE_PLAN.map((t) => t.tableName));
    for (const t of [
      "users",
      "accounts",
      "sessions",
      "subscriptions",
      "invoices",
      "processed_stripe_events",
      "audit_log",
      "usage_events",
    ]) {
      expect(wiped.has(t)).toBe(false);
      expect(KEEP_TABLES.has(t)).toBe(true);
    }
  });
});

describe("wipe plan — FK-safe delete order", () => {
  // For any cascade FK child → parent where BOTH are in the wipe set,
  // the child must be deleted (appear) before the parent. Otherwise
  // deleting the parent would cascade the child away and the explicit
  // child delete would report a misleading count of 0.
  it("deletes cascade-children before their parents", () => {
    const order = new Map(
      WIPE_PLAN.map((t, i) => [t.tableName, i] as const)
    );
    const byName = new Map(WIPE_PLAN.map((t) => [t.tableName, t]));

    for (const target of WIPE_PLAN) {
      const cfg = getTableConfig(target.table);
      for (const fk of cfg.foreignKeys) {
        if (fk.onDelete !== "cascade") continue;
        const parentName = getTableConfig(
          fk.reference().foreignTable
        ).name;
        if (parentName === target.tableName) continue;
        if (!byName.has(parentName)) continue; // parent kept, not in plan
        expect(order.get(target.tableName)!).toBeLessThan(
          order.get(parentName)!
        );
      }
    }
  });

  it("spot-checks known parent/child pairs land child-first", () => {
    const order = new Map(WIPE_PLAN.map((t, i) => [t.tableName, i] as const));
    const pairs: Array<[string, string]> = [
      ["entity_links", "entities"],
      ["send_queue", "agent_drafts"],
      ["syllabus_chunks", "syllabi"],
      ["mistake_note_chunks", "mistake_notes"],
      ["event_pre_briefs", "events"],
    ];
    for (const [child, parent] of pairs) {
      expect(order.get(child)!).toBeLessThan(order.get(parent)!);
    }
  });
});
