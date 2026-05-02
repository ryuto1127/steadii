// Plain-module constants shared between the server Sidebar shell and the
// client SidebarNav. Keeping them out of the "use client" module avoids the
// Next.js client-reference proxy, which wraps non-function exports in a way
// that makes them non-iterable from a server component.

// Phase 6: Inbox is pinned to index 0. `g i` jumps to it. Sidebar order is
// locked by the pre-launch redesign memo (revised 2026-04-25 to 6 items
// with Tasks at the bottom).
export const NAV_ITEM_KEYS = [
  "inbox",
  "home",
  "chats",
  "classes",
  "calendar",
  "tasks",
] as const;

export type NavItemKey = (typeof NAV_ITEM_KEYS)[number];

export const NAV_HREFS: Record<NavItemKey, string> = {
  inbox: "/app/inbox",
  home: "/app",
  chats: "/app/chats",
  classes: "/app/classes",
  calendar: "/app/calendar",
  tasks: "/app/tasks",
};

// Keyboard shortcut: `g` then a letter jumps to that section. Settings is
// intentionally not in the sidebar rail — it lives behind the account
// footer link — so it has no `g`-shortcut.
//
// Wave 1 secretary-pivot remap (2026-05-01):
//   `c` → calendar (mnemonic match — calendar is the primary daily check)
//   `j` → chats    (was `c`; freed for calendar; "j" hints at journal/recent
//                   and aligns with the Wave 2 履歴 rename)
//   `k` → classes  (was `l`; "k" for klass/kurasu — clearer than `l`)
// All bindings remain unique; no collisions.
export const NAV_SHORTCUTS: Record<NavItemKey, string> = {
  inbox: "i",
  home: "h",
  chats: "j",
  classes: "k",
  calendar: "c",
  tasks: "t",
};
