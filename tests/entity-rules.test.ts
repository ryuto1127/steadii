import { describe, expect, it } from "vitest";
import { fadingEntityRule } from "@/lib/agent/proactive/rules/fading-entity";
import { entityDeadlineClusterRule } from "@/lib/agent/proactive/rules/entity-deadline-cluster";
import type { UserSnapshot } from "@/lib/agent/proactive/types";

// engineer-51 — unit tests for the entity-graph-driven proactive rules.
// Cover the fire / no-fire boundary plus the dedup-key shape.

const NOW = new Date("2026-05-12T00:00:00Z");

function emptySnapshot(): UserSnapshot {
  return {
    userId: "u1",
    now: NOW,
    timezone: "America/Vancouver",
    classes: [],
    calendarEvents: [],
    assignments: [],
    syllabi: [],
    classTimeBlocks: [],
    examWindows: [],
    recentClassActivityDays: {},
    monthlyReview: null,
    entitySignals: [],
  };
}

describe("entity_fading rule", () => {
  it("fires when daysSinceLastLink crosses mean + 2σ for an applicable kind", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "e1",
        kind: "person",
        displayName: "Prof. Tanaka",
        daysSinceLastLink: 30,
        meanGapDays: 5,
        stddevGapDays: 2,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
    ];
    const issues = fadingEntityRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("entity_fading");
    expect(issues[0].sourceRecordIds).toEqual(["e1"]);
    expect(issues[0].issueSummary).toContain("Prof. Tanaka");
    expect(issues[0].issueSummary).toContain("30");
  });

  it("does not fire under the 7-day minimum even if the threshold is crossed", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "e2",
        kind: "person",
        displayName: "Lab partner",
        daysSinceLastLink: 5,
        meanGapDays: 1,
        stddevGapDays: 0.5,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
    ];
    expect(fadingEntityRule.detect(snapshot)).toHaveLength(0);
  });

  it("does not fire below threshold (within normal cadence)", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "e3",
        kind: "person",
        displayName: "Advisor",
        daysSinceLastLink: 9,
        meanGapDays: 7,
        stddevGapDays: 2,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
    ];
    expect(fadingEntityRule.detect(snapshot)).toHaveLength(0);
  });

  it("skips course/event_series kinds (term-bound cadence is structural)", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "c1",
        kind: "course",
        displayName: "MAT223",
        daysSinceLastLink: 60,
        meanGapDays: 3,
        stddevGapDays: 1,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
      {
        entityId: "es1",
        kind: "event_series",
        displayName: "TA hours",
        daysSinceLastLink: 60,
        meanGapDays: 3,
        stddevGapDays: 1,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
    ];
    expect(fadingEntityRule.detect(snapshot)).toHaveLength(0);
  });

  it("skips entities without enough history (meanGapDays null)", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "e4",
        kind: "project",
        displayName: "New project",
        daysSinceLastLink: 30,
        meanGapDays: null,
        stddevGapDays: null,
        upcomingItemCount: 0,
        upcomingItemRefs: [],
      },
    ];
    expect(fadingEntityRule.detect(snapshot)).toHaveLength(0);
  });
});

describe("entity_deadline_cluster rule", () => {
  it("fires when an entity has ≥3 upcoming items in the next 7 days", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "p1",
        kind: "project",
        displayName: "令和トラベル",
        daysSinceLastLink: 1,
        meanGapDays: 1,
        stddevGapDays: 0.5,
        upcomingItemCount: 3,
        upcomingItemRefs: [
          {
            kind: "assignment",
            id: "a1",
            title: "Slide draft",
            occursAt: new Date("2026-05-13T00:00:00Z"),
          },
          {
            kind: "calendar_event",
            id: "e1",
            title: "Interview prep",
            occursAt: new Date("2026-05-14T15:00:00Z"),
          },
          {
            kind: "assignment",
            id: "a2",
            title: "Send confirmation",
            occursAt: new Date("2026-05-15T12:00:00Z"),
          },
        ],
      },
    ];
    const issues = entityDeadlineClusterRule.detect(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("entity_deadline_cluster");
    expect(issues[0].sourceRecordIds[0]).toBe("p1");
    // Source records include both the entity AND the cluster items —
    // sorted by occursAt — so new clusters get a fresh dedup key.
    expect(issues[0].sourceRecordIds).toContain("a1");
    expect(issues[0].sourceRecordIds).toContain("a2");
    expect(issues[0].sourceRefs.length).toBeGreaterThan(1);
  });

  it("does not fire under the 3-item threshold", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "p2",
        kind: "project",
        displayName: "Quiet project",
        daysSinceLastLink: 1,
        meanGapDays: 1,
        stddevGapDays: 0.5,
        upcomingItemCount: 2,
        upcomingItemRefs: [
          {
            kind: "assignment",
            id: "a3",
            title: "Foo",
            occursAt: new Date("2026-05-13T00:00:00Z"),
          },
          {
            kind: "calendar_event",
            id: "e2",
            title: "Bar",
            occursAt: new Date("2026-05-14T00:00:00Z"),
          },
        ],
      },
    ];
    expect(entityDeadlineClusterRule.detect(snapshot)).toHaveLength(0);
  });

  it("skips person kind (cluster framing assumes a project-like entity)", () => {
    const snapshot = emptySnapshot();
    snapshot.entitySignals = [
      {
        entityId: "person1",
        kind: "person",
        displayName: "Recruiter",
        daysSinceLastLink: 1,
        meanGapDays: 1,
        stddevGapDays: 0.5,
        upcomingItemCount: 5,
        upcomingItemRefs: [
          {
            kind: "calendar_event",
            id: "e3",
            title: "Interview 1",
            occursAt: new Date("2026-05-13T00:00:00Z"),
          },
          {
            kind: "calendar_event",
            id: "e4",
            title: "Interview 2",
            occursAt: new Date("2026-05-14T00:00:00Z"),
          },
          {
            kind: "calendar_event",
            id: "e5",
            title: "Interview 3",
            occursAt: new Date("2026-05-15T00:00:00Z"),
          },
        ],
      },
    ];
    expect(entityDeadlineClusterRule.detect(snapshot)).toHaveLength(0);
  });
});
