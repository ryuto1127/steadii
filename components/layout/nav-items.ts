// Plain-module constants shared between the server Sidebar shell and the
// client SidebarNav. Keeping them out of the "use client" module avoids the
// Next.js client-reference proxy, which wraps non-function exports in a way
// that makes them non-iterable from a server component.

export const NAV_ITEM_KEYS = [
  "home",
  "chats",
  "classes",
  "calendar",
  "settings",
] as const;

export type NavItemKey = (typeof NAV_ITEM_KEYS)[number];

export const NAV_HREFS: Record<NavItemKey, string> = {
  home: "/app",
  chats: "/app/chats",
  classes: "/app/classes",
  calendar: "/app/calendar",
  settings: "/app/settings",
};

// Keyboard shortcut: `g` then the first letter of the nav key jumps to that
// section. §4.1 spec.
export const NAV_SHORTCUTS: Record<NavItemKey, string> = {
  home: "h",
  chats: "c",
  classes: "l",
  calendar: "a",
  settings: "s",
};
