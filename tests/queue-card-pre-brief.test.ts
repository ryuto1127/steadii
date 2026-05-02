import { describe, expect, it } from "vitest";
import type {
  QueueCardB,
  QueueCardBInformational,
} from "@/lib/agent/queue/types";

// Wave 3.1 verification — the Type B "informational" variant must:
//   1. Discriminate on `mode` so render branches stay type-safe.
//   2. Carry bullets + secondaryActions (no draftPreview / subjectLine).
//   3. Be assignable to the QueueCardB union without unsafe casts.
//   4. Surface a "Mark reviewed" inline action separately from the
//      Dismiss control.
//
// We don't render JSX here (vitest is node-only per vitest.config.ts).
// The tests assert the type contract via shape checks and the discrim-
// inated-union narrowing the renderer relies on.

describe("Type B informational variant", () => {
  it("rejects assignment without mode='informational'", () => {
    // @ts-expect-error mode is required on the discriminated union
    const _bad: QueueCardBInformational = {
      id: "x",
      archetype: "B",
      title: "x",
      body: "x",
      confidence: "high",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: false,
      bullets: [],
      secondaryActions: [],
    };
    void _bad;
    expect(true).toBe(true);
  });

  it("accepts a valid informational card", () => {
    const card: QueueCardBInformational = {
      id: "pre_brief:00000000-0000-0000-0000-000000000010",
      archetype: "B",
      mode: "informational",
      title: "Meeting with Prof Tanaka in 14 min",
      body: "MAT223 office hours · 14:00–14:30",
      confidence: "high",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: false,
      bullets: [
        "Last email from Prof Tanaka (Apr 28): granted 5-day extension on PS5.",
        "Pending decision: which textbook chapter to focus on next.",
      ],
      secondaryActions: [
        { key: "open_calendar", label: "Open in Calendar", href: "/cal" },
        { key: "mark_reviewed", label: "Mark reviewed", action: "mark_reviewed" },
      ],
    };
    expect(card.bullets).toHaveLength(2);
    expect(card.secondaryActions[1]?.action).toBe("mark_reviewed");
  });

  it("narrows correctly on the union via mode", () => {
    const informational: QueueCardB = {
      id: "pre_brief:1",
      archetype: "B",
      mode: "informational",
      title: "x",
      body: "x",
      confidence: "high",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: false,
      bullets: ["one"],
      secondaryActions: [],
    };
    const draft: QueueCardB = {
      id: "draft:1",
      archetype: "B",
      mode: "draft",
      title: "x",
      body: "x",
      confidence: "high",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: true,
      draftPreview: "preview",
    };

    function previewLength(c: QueueCardB): number {
      // Only valid when narrowed via mode discriminator.
      if (c.mode === "informational") return c.bullets.length;
      return c.draftPreview.length;
    }

    expect(previewLength(informational)).toBe(1);
    expect(previewLength(draft)).toBeGreaterThan(0);
  });
});
