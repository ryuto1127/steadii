import { describe, expect, it } from "vitest";
import {
  NAV_HREFS,
  NAV_ITEM_KEYS,
  NAV_SHORTCUTS,
} from "@/components/layout/nav-items";

describe("Sidebar keyboard nav config", () => {
  it("exposes exactly the 4 top-level items (settings lives in the account footer)", () => {
    expect([...NAV_ITEM_KEYS]).toEqual([
      "home",
      "chats",
      "classes",
      "calendar",
    ]);
  });

  it("maps each item to its documented href", () => {
    expect(NAV_HREFS.home).toBe("/app");
    expect(NAV_HREFS.chats).toBe("/app/chats");
    expect(NAV_HREFS.classes).toBe("/app/classes");
    expect(NAV_HREFS.calendar).toBe("/app/calendar");
  });

  it("assigns a unique single-letter `g` shortcut to each item", () => {
    const letters = Object.values(NAV_SHORTCUTS);
    const unique = new Set(letters);
    expect(unique.size).toBe(letters.length);
    for (const letter of letters) expect(letter).toMatch(/^[a-z]$/);
  });

  it("includes every nav item in the shortcuts map", () => {
    for (const key of NAV_ITEM_KEYS) {
      expect(NAV_SHORTCUTS[key]).toBeTypeOf("string");
    }
  });
});
