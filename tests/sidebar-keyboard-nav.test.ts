import { describe, expect, it } from "vitest";
import {
  ALL_NAV_ITEM_KEYS,
  NAV_HREFS,
  NAV_ITEM_KEYS,
  NAV_SHORTCUTS,
  SECONDARY_NAV_ITEM_KEYS,
} from "@/components/layout/nav-items";

describe("Sidebar keyboard nav config", () => {
  it("primary block is Wave 2 secretary order — Home first, no Chats", () => {
    // Wave 2 lock per `project_wave_2_home_design.md`: Home is the
    // primary destination; 履歴 (chats) demoted to the secondary block.
    expect([...NAV_ITEM_KEYS]).toEqual([
      "home",
      "inbox",
      "calendar",
      "tasks",
      "classes",
    ]);
    expect(NAV_ITEM_KEYS[0]).toBe("home");
    expect(NAV_ITEM_KEYS).not.toContain("chats");
  });

  it("secondary block contains the demoted chats / 履歴 entry", () => {
    expect([...SECONDARY_NAV_ITEM_KEYS]).toEqual(["chats"]);
  });

  it("the union (ALL_NAV_ITEM_KEYS) covers every routable item", () => {
    expect([...ALL_NAV_ITEM_KEYS].sort()).toEqual(
      ["calendar", "chats", "classes", "home", "inbox", "tasks"].sort()
    );
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

  it("binds `g j` to the demoted 履歴 item", () => {
    // Wave 1 freed `j` for chat history (renamed 履歴 in Wave 2). Lock
    // the binding so the shortcut survives future re-orderings.
    expect(NAV_SHORTCUTS.chats).toBe("j");
  });

  it("includes every nav item in the shortcuts map", () => {
    for (const key of ALL_NAV_ITEM_KEYS) {
      expect(NAV_SHORTCUTS[key]).toBeTypeOf("string");
    }
  });
});
