import { describe, expect, it } from "vitest";
import { queueShowMoreState } from "@/lib/agent/queue/visual";

// PART 3 — the bottom show-more / show-less control. Logic is in a pure
// helper so the count math + label selection are testable without
// mounting React (vitest is node-only here). QUEUE_VISIBLE_LIMIT = 7.
const LIMIT = 7;

describe("queueShowMoreState", () => {
  it("hides the toggle when the queue fits within the visible cap", () => {
    for (const total of [0, 1, LIMIT - 1, LIMIT]) {
      const s = queueShowMoreState({
        totalCount: total,
        visibleLimit: LIMIT,
        expanded: false,
      });
      expect(s.shouldShowToggle).toBe(false);
      expect(s.hiddenCount).toBe(0);
    }
  });

  it("collapsed: shows the toggle with the correct hidden count and show_more_count label", () => {
    // 10 cards, cap 7 → 3 hidden.
    const s = queueShowMoreState({
      totalCount: 10,
      visibleLimit: LIMIT,
      expanded: false,
    });
    expect(s.shouldShowToggle).toBe(true);
    expect(s.hiddenCount).toBe(3);
    expect(s.labelKey).toBe("show_more_count");
    expect(s.labelValues).toEqual({ n: 3 });
    // Expanding reveals inline below the button — no scroll needed.
    expect(s.scrollToHeadingOnClick).toBe(false);
  });

  it("expanded: shows the toggle with the show_less label and no count", () => {
    const s = queueShowMoreState({
      totalCount: 10,
      visibleLimit: LIMIT,
      expanded: true,
    });
    expect(s.shouldShowToggle).toBe(true);
    // hiddenCount stays stable regardless of expanded state.
    expect(s.hiddenCount).toBe(3);
    expect(s.labelKey).toBe("show_less");
    expect(s.labelValues).toBeUndefined();
    // Collapsing should scroll the user back up to the heading.
    expect(s.scrollToHeadingOnClick).toBe(true);
  });

  it("interpolates the exact overflow count for the あと{n}件 label", () => {
    const s = queueShowMoreState({
      totalCount: LIMIT + 1,
      visibleLimit: LIMIT,
      expanded: false,
    });
    expect(s.labelValues).toEqual({ n: 1 });
  });
});
