import { describe, expect, it } from "vitest";
import {
  NAV_HREFS,
  NAV_ITEM_KEYS,
  NAV_SHORTCUTS,
} from "@/components/layout/nav-items";

describe("Sidebar keyboard nav config", () => {
  it("exposes exactly 6 top-level items with Inbox at the top and Tasks at the bottom", () => {
    // Settings lives in the account footer, not the rail. Phase 7 W1
    // revised the locked sidebar to 6 items with Tasks at index 5.
    expect([...NAV_ITEM_KEYS]).toEqual([
      "inbox",
      "home",
      "chats",
      "classes",
      "calendar",
      "tasks",
    ]);
    // Inbox is the first item; memory-locked.
    expect(NAV_ITEM_KEYS[0]).toBe("inbox");
    expect(NAV_ITEM_KEYS[NAV_ITEM_KEYS.length - 1]).toBe("tasks");
  });

  it("maps each item to its documented href", () => {
    expect(NAV_HREFS.inbox).toBe("/app/inbox");
    expect(NAV_HREFS.home).toBe("/app");
    expect(NAV_HREFS.chats).toBe("/app/chats");
    expect(NAV_HREFS.classes).toBe("/app/classes");
    expect(NAV_HREFS.calendar).toBe("/app/calendar");
    expect(NAV_HREFS.tasks).toBe("/app/tasks");
  });

  it("assigns a unique single-letter `g` shortcut to each item", () => {
    const letters = Object.values(NAV_SHORTCUTS);
    const unique = new Set(letters);
    expect(unique.size).toBe(letters.length);
    for (const letter of letters) expect(letter).toMatch(/^[a-z]$/);
  });

  it("binds `g i` to the Inbox item", () => {
    expect(NAV_SHORTCUTS.inbox).toBe("i");
  });

  it("binds `g t` to the Tasks item", () => {
    expect(NAV_SHORTCUTS.tasks).toBe("t");
  });

  it("includes every nav item in the shortcuts map", () => {
    for (const key of NAV_ITEM_KEYS) {
      expect(NAV_SHORTCUTS[key]).toBeTypeOf("string");
    }
  });
});
