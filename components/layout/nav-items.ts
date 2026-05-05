// Plain-module constants shared between the server Sidebar shell and the
// client SidebarNav. Keeping them out of the "use client" module avoids the
// Next.js client-reference proxy, which wraps non-function exports in a way
// that makes them non-iterable from a server component.

// Wave 2 secretary-pivot order (2026-05-01) per
// `project_wave_2_home_design.md`. Home is the primary destination
// (queue + command + briefing); Inbox sits next as the "show me
// everything triaged" catch-up surface; Calendar / Tasks / Classes
// follow. 履歴 (renamed from チャット) is demoted to the secondary
// section below the visual separator (`SECONDARY_NAV_ITEM_KEYS`).
export const NAV_ITEM_KEYS = [
  "home",
  "inbox",
  "calendar",
  "tasks",
  "classes",
  "activity",
] as const;

// Secondary section — items below the rule. The sidebar shell renders a
// subtle separator between the primary block and this one. Settings is
// still NOT in the rail (it lives behind the account footer link).
export const SECONDARY_NAV_ITEM_KEYS = ["chats"] as const;

export type NavItemKey =
  | (typeof NAV_ITEM_KEYS)[number]
  | (typeof SECONDARY_NAV_ITEM_KEYS)[number];

export const ALL_NAV_ITEM_KEYS: readonly NavItemKey[] = [
  ...NAV_ITEM_KEYS,
  ...SECONDARY_NAV_ITEM_KEYS,
];

export const NAV_HREFS: Record<NavItemKey, string> = {
  inbox: "/app/inbox",
  home: "/app",
  chats: "/app/chats",
  classes: "/app/classes",
  calendar: "/app/calendar",
  tasks: "/app/tasks",
  activity: "/app/activity",
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
  // 'a' for activity — unique among existing letters and matches the
  // first letter of "Activity" / 「アクティビティ」.
  activity: "a",
};
