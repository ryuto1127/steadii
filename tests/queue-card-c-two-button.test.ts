import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Type C "soft notice" card — new two-button model (確認済み / 不要), body
// navigates to the detail route, no 対応する / snooze on this surface.
//
// vitest is node-only here (no jsdom; see vitest.config.ts), so — exactly as
// tests/command-palette.test.ts and tests/today-tasks-one-click.test.ts do for
// client components — we cover the card via (a) the module export contract the
// dispatcher depends on and (b) light STRUCTURAL assertions over the renderer
// source. The behavioral guarantees live in the server-action tests
// (queue-mark-not-needed / inbox-row-actions); this file just pins the UI
// wiring so a future edit can't silently re-introduce the old affordances.

const cardSrc = readFileSync(
  join(__dirname, "..", "components", "agent", "queue-card.tsx"),
  "utf8"
);

// Isolate the Type C renderer body so assertions don't accidentally match a
// different archetype's block (Type A/E still legitimately use snooze etc.).
function typeCBlock(): string {
  const start = cardSrc.indexOf("export function QueueCardCRender");
  expect(start).toBeGreaterThan(-1);
  // The next renderer ("// ── Type D") bounds the block.
  const end = cardSrc.indexOf("// ── Type D", start);
  expect(end).toBeGreaterThan(start);
  return cardSrc.slice(start, end);
}

describe("QueueCardCRender — two-button model", () => {
  it("exports the renderer the dispatcher imports", async () => {
    const mod = await import("@/components/agent/queue-card");
    expect(typeof mod.QueueCardCRender).toBe("function");
    expect(typeof mod.QueueCardRenderer).toBe("function");
  });

  it("renders exactly the two new action labels (確認済み + 不要)", () => {
    const block = typeCBlock();
    expect(block).toContain('tShared("confirmed")');
    expect(block).toContain('tShared("not_needed")');
  });

  it("makes the card body a clickable navigation target (onOpen)", () => {
    const block = typeCBlock();
    expect(block).toContain("onOpen");
    expect(block).toContain('role="button"');
    expect(block).toContain("onClick={open}");
  });

  it("drops the old 対応する (take_action) primary and snooze/dismiss affordances from this card", () => {
    const block = typeCBlock();
    // No 対応する CTA, no card-level dismiss/snooze button (the quick menu
    // still exists for power paths but is not a visible button here).
    expect(block).not.toContain("take_action");
    expect(block).not.toContain("primaryActionLabel");
    expect(block).not.toContain('tShared("dismiss")');
    expect(block).not.toContain("onTakeAction");
  });

  it("the action buttons stop propagation so they don't trigger body navigation", () => {
    const block = typeCBlock();
    expect(block).toContain("stopPropagation");
  });
});
